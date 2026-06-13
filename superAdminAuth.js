/** SHA-256 hash karşılaştırması — düz metin şifre kaynak kodda tutulmaz. */
const EXPECTED_USER_HASH = "186cf774c97b60a1c106ef718d10970a6a06e06bef89553d9ae65d938a886eae";
const EXPECTED_PASS_HASH = "adc0c9d173fa373f230a851508db20c98527c65616481cfbe1fbf7eff7c7255c";

async function sha256(text) {
    const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

export async function validateSuperAdminLogin(username, password) {
    if (!username?.trim() || !password) return false;

    const [userHash, passHash] = await Promise.all([
        sha256(username.trim().toLowerCase()),
        sha256(password)
    ]);

    return userHash === EXPECTED_USER_HASH && passHash === EXPECTED_PASS_HASH;
}
