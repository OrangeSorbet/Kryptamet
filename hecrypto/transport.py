import base64
import hashlib
import os
import secrets
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag


def generate_rsa_keypair(key_size=2048):
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=key_size)
    public_key = private_key.public_key()
    return private_key, public_key


def save_rsa_private_key(private_key, path):
    with open(path, "wb") as f:
        f.write(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ))


def save_rsa_public_key(public_key, path):
    with open(path, "wb") as f:
        f.write(public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ))


def load_rsa_private_key(path):
    with open(path, "rb") as f:
        return serialization.load_pem_private_key(f.read(), password=None)


def load_rsa_public_key(path):
    with open(path, "rb") as f:
        return serialization.load_pem_public_key(f.read())


def _rsa_encrypt_key(public_key, aes_key):
    return public_key.encrypt(
        aes_key,
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )


def _rsa_decrypt_key(private_key, encrypted_key):
    return private_key.decrypt(
        encrypted_key,
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )


def new_aes_key():
    return os.urandom(32)


def new_salt():
    return os.urandom(16)


def new_passphrase():
    return secrets.token_urlsafe(12)


def derive_key_from_passphrase(passphrase, salt):
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=200000)
    return kdf.derive(passphrase.encode("utf-8"))


NONCE_BYTES = 12
TAG_BYTES = 16


def _gcm_encrypt(aes_key, payload_bytes, aad=b""):
    """AES-256-GCM: fresh 96-bit nonce; returns (nonce, ciphertext, tag). The library emits ct || tag."""
    if len(aes_key) != 32:
        raise ValueError(f"AES-256 key must be 32 bytes, got {len(aes_key)}")
    nonce = os.urandom(NONCE_BYTES)
    ct_tag = AESGCM(aes_key).encrypt(nonce, payload_bytes, aad)
    return nonce, ct_tag[:-TAG_BYTES], ct_tag[-TAG_BYTES:]


def _gcm_decrypt(aes_key, nonce, ciphertext, tag, aad=b""):
    """Raises cryptography.exceptions.InvalidTag if nonce, ciphertext, tag or aad were altered."""
    return AESGCM(aes_key).decrypt(nonce, ciphertext + tag, aad)


def wrap_with_passphrase(passphrase, payload_bytes, aad=b""):
    salt = os.urandom(16)
    nonce, ciphertext, tag = _gcm_encrypt(derive_key_from_passphrase(passphrase, salt), payload_bytes, aad)
    return {"salt": salt, "nonce": nonce, "ciphertext": ciphertext, "tag": tag, "aad": aad}


def unwrap_with_passphrase(passphrase, wrapped):
    aes_key = derive_key_from_passphrase(passphrase, wrapped["salt"])
    return _gcm_decrypt(aes_key, wrapped["nonce"], wrapped["ciphertext"], wrapped["tag"], wrapped["aad"])


def _aad_utf8(aad):
    try:
        return aad.decode("utf-8")
    except UnicodeDecodeError:
        return None


def wrap_payload_traced(public_key, payload_bytes, aes_key=None, aad=b""):
    """Same as wrap_payload but also returns the raw AES key/nonce/ciphertext/tag for
    educational display (never do this in a real deployment)."""
    aes_key = aes_key if aes_key is not None else os.urandom(32)
    wrapped = wrap_payload(public_key, payload_bytes, aes_key=aes_key, aad=aad)
    return {
        **wrapped,
        "aes_key_hex": aes_key.hex(),
        "nonce_hex": wrapped["nonce"].hex(),
        "tag_hex": wrapped["tag"].hex(),
        "aad_hex": aad.hex(),
        "aad_utf8": _aad_utf8(aad),
        "encrypted_aes_key_b64": base64.b64encode(wrapped["encrypted_key"]).decode("ascii"),
        "aes_ciphertext_b64": base64.b64encode(wrapped["ciphertext"]).decode("ascii"),
        "payload_sha256": hashlib.sha256(payload_bytes).hexdigest(),
        "aes_ciphertext_sha256": hashlib.sha256(wrapped["ciphertext"]).hexdigest(),
        "aes_ciphertext_size": len(wrapped["ciphertext"]),
        "tag_size": len(wrapped["tag"]),
        "nonce_size": len(wrapped["nonce"]),
        "encrypted_aes_key_size": len(wrapped["encrypted_key"]),
    }


def wrap_payload(public_key, payload_bytes, aes_key=None, aad=b""):
    if aes_key is None:
        aes_key = os.urandom(32)
    nonce, ciphertext, tag = _gcm_encrypt(aes_key, payload_bytes, aad)
    return {
        "encrypted_key": _rsa_encrypt_key(public_key, aes_key),
        "nonce": nonce,
        "ciphertext": ciphertext,
        "tag": tag,
        "aad": aad,
    }


def unwrap_payload(private_key, wrapped):
    aes_key = _rsa_decrypt_key(private_key, wrapped["encrypted_key"])
    return _gcm_decrypt(aes_key, wrapped["nonce"], wrapped["ciphertext"], wrapped["tag"], wrapped["aad"])


def unwrap_payload_traced(private_key, wrapped):
    """unwrap_payload plus the recovered AES key and a SHA-256 of the recovered
    bytes, so the caller can compare it to the sender's payload_sha256. Reaching the
    return means the GCM tag verified (otherwise InvalidTag propagates)."""
    aes_key = _rsa_decrypt_key(private_key, wrapped["encrypted_key"])
    payload_bytes = _gcm_decrypt(aes_key, wrapped["nonce"], wrapped["ciphertext"], wrapped["tag"], wrapped["aad"])
    return payload_bytes, {
        "aes_key_hex": aes_key.hex(),
        "payload_sha256": hashlib.sha256(payload_bytes).hexdigest(),
        "tag_hex": wrapped["tag"].hex(),
        "tag_verified": True,
    }


def _flip_and_try(aes_key, wrapped, field):
    data = bytearray(wrapped[field])
    index, bit = secrets.randbelow(len(data)), secrets.randbelow(8)
    before = data[index]
    data[index] ^= 1 << bit
    tampered = {**wrapped, field: bytes(data)}
    try:
        _gcm_decrypt(aes_key, tampered["nonce"], tampered["ciphertext"], tampered["tag"], tampered["aad"])
    except InvalidTag:
        return {"field": field, "flipped_byte_index": index, "bit": bit, "byte_before": f"{before:02x}",
                "byte_after": f"{data[index]:02x}", "field_size": len(data), "rejected": True, "error": "InvalidTag"}
    raise RuntimeError(f"AES-GCM accepted a {field} with bit {bit} of byte {index} flipped")


def tamper_test(private_key_or_key, wrapped):
    """Really flips one random bit of the ciphertext (and, separately, of the tag) in a copy of
    `wrapped` and tries to decrypt it. Returns the ciphertext flip at top level plus `tag_flip`;
    raises RuntimeError if either tampered copy was accepted."""
    aes_key = (private_key_or_key if isinstance(private_key_or_key, bytes)
               else _rsa_decrypt_key(private_key_or_key, wrapped["encrypted_key"]))
    _gcm_decrypt(aes_key, wrapped["nonce"], wrapped["ciphertext"], wrapped["tag"], wrapped["aad"])
    return {**_flip_and_try(aes_key, wrapped, "ciphertext"), "untampered_decrypts": True,
            "tag_flip": _flip_and_try(aes_key, wrapped, "tag")}
