import { ensureAuthFoundationInitialized } from "./authService.js";
import { getAuthInstance } from "./firebase-config.js";
import { fetchMembershipForUid } from "./membershipService.js";
import { signInEmailOwner } from "./emailOwnerLoginCore.js";

export async function signInWithEmailOwnerAuth(email, password) {
    await ensureAuthFoundationInitialized();
    const auth = await getAuthInstance();
    const { signInWithEmailAndPassword, signOut } = await import(
        "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
    );
    return signInEmailOwner(email, password, {
        signIn: async (address, secret) => (await signInWithEmailAndPassword(auth, address, secret)).user,
        fetchMembership: fetchMembershipForUid,
        signOut: () => signOut(auth)
    });
}
