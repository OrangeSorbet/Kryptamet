// Browser-side re-computation of one traced SHA-256 block (FIPS 180-4) from
// the backend's trace (pbkdf2.inner_sha256_trace.blocks[i]): every message-
// schedule word W_t and every round's T1/T2/new registers are recomputed
// here and compared with the client's values, so the matrices the Key Setup
// chapter shows are checked, not just displayed.
const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const shaRotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
const shaHex = (x) => (x >>> 0).toString(16).padStart(8, "0");
const shaWord = (h) => parseInt(h, 16) >>> 0;

// Returns { schedule: [{t, value, ok}], rounds: [{t, T1, T2, K, W, ok}],
//           hAfterOk, allOk } -- hex strings for display.
function checkSha256Block(block) {
    const W = block.schedule.map(shaWord);
    const schedule = W.map((w, t) => {
        if (t < 16) return { t, value: shaHex(w), ok: shaWord(block.words[t]) === w };
        const s0 = shaRotr(W[t - 15], 7) ^ shaRotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        const s1 = shaRotr(W[t - 2], 17) ^ shaRotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        return { t, value: shaHex(w), ok: ((W[t - 16] + s0 + W[t - 7] + s1) >>> 0) === w };
    });
    let prev = block.H_before.map(shaWord);
    const rounds = block.rounds.map((row, t) => {
        const [a, b, c, d, e, f, g, h] = prev;
        const S1 = shaRotr(e, 6) ^ shaRotr(e, 11) ^ shaRotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const T1 = (h + S1 + ch + SHA256_K[t] + W[t]) >>> 0;
        const S0 = shaRotr(a, 2) ^ shaRotr(a, 13) ^ shaRotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const T2 = (S0 + maj) >>> 0;
        const next = [(T1 + T2) >>> 0, a, b, c, (d + T1) >>> 0, e, f, g];
        const actual = row.map(shaWord);
        prev = actual;
        return { t, T1: shaHex(T1), T2: shaHex(T2), K: shaHex(SHA256_K[t]), W: shaHex(W[t]), ok: next.every((v, i) => v === actual[i]) };
    });
    const hIn = block.H_before.map(shaWord);
    const hAfterOk = prev.every((v, i) => ((v + hIn[i]) >>> 0) === shaWord(block.H_after[i]));
    return {
        schedule, rounds, hAfterOk,
        allOk: hAfterOk && schedule.every((s) => s.ok) && rounds.every((r) => r.ok),
    };
}
