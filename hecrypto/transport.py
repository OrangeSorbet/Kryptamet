import os
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


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


def wrap_payload_traced(public_key, payload_bytes):
    """Same as wrap_payload but also returns the raw AES key/iv/ciphertext for
    educational display (never do this in a real deployment)."""
    wrapped = wrap_payload(public_key, payload_bytes)
    return {
        **wrapped,
        "aes_ciphertext_size": len(wrapped["ciphertext"]),
        "aes_ciphertext_hex_preview": wrapped["ciphertext"][:64].hex(),
        "encrypted_aes_key_hex_preview": wrapped["encrypted_key"][:64].hex(),
        "encrypted_aes_key_size": len(wrapped["encrypted_key"]),
    }


def wrap_payload(public_key, payload_bytes):
    aes_key = os.urandom(32)
    iv = os.urandom(16)

    padder_len = 16 - (len(payload_bytes) % 16)
    padded = payload_bytes + bytes([padder_len]) * padder_len

    cipher = Cipher(algorithms.AES(aes_key), modes.CBC(iv))
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(padded) + encryptor.finalize()

    encrypted_aes_key = _rsa_encrypt_key(public_key, aes_key)

    return {
        "encrypted_key": encrypted_aes_key,
        "iv": iv,
        "ciphertext": ciphertext,
    }


def unwrap_payload(private_key, wrapped):
    aes_key = _rsa_decrypt_key(private_key, wrapped["encrypted_key"])

    cipher = Cipher(algorithms.AES(aes_key), modes.CBC(wrapped["iv"]))
    decryptor = cipher.decryptor()
    padded = decryptor.update(wrapped["ciphertext"]) + decryptor.finalize()

    padder_len = padded[-1]
    return padded[:-padder_len]
