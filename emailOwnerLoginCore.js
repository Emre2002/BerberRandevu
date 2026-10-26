export async function signInEmailOwner(
    email, password,
    { signIn, fetchMembership, signOut }
) {
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || !password) {
        throw new Error("email_owner_invalid_credentials");
    }
    const user = await signIn(normalizedEmail, password);
    let membership;
    try {
        membership = await fetchMembership(user.uid);
    } catch {
        await signOut().catch(() => {});
        throw new Error("email_owner_membership_unavailable");
    }
    if (!membership || membership.uid !== user.uid || membership.role !== "owner"
        || membership.status !== "active" || !membership.businessId) {
        await signOut().catch(() => {});
        throw new Error("email_owner_membership_required");
    }
    return { businessId: membership.businessId };
}
