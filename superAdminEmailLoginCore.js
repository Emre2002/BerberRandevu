export async function signInSuperAdminEmail(email, password, { signIn, signOut }) {
    const address = typeof email === "string" ? email.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || !password) {
        throw new Error("super_admin_invalid_credentials");
    }

    const user = await signIn(address, password);
    let tokenResult;
    try {
        tokenResult = await user.getIdTokenResult(true);
    } catch {
        await signOut().catch(() => {});
        throw new Error("super_admin_claim_unavailable");
    }
    if (tokenResult.claims?.superAdmin !== true) {
        await signOut().catch(() => {});
        throw new Error("super_admin_missing_claim");
    }
    return { email: address };
}
