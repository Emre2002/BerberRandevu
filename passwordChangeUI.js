import { getAuthInstance } from "./firebase-config.js";
import { changePasswordWithAuth, submitPasswordChangeForm } from "./passwordChangeCore.js";

async function changeSignedInPassword(values) {
    const auth = await getAuthInstance();
    const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } = await import(
        "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
    );
    return changePasswordWithAuth(
        { user: auth.currentUser, ...values },
        {
            credential: (email, password) => EmailAuthProvider.credential(email, password),
            reauthenticate: reauthenticateWithCredential,
            updatePassword,
            isCurrentUser: (user) => auth.currentUser?.uid === user.uid
        }
    );
}

export function bindPasswordChangeForm(form) {
    form?.addEventListener("submit", (event) => {
        event.preventDefault();
        void submitPasswordChangeForm(form, changeSignedInPassword);
    });
}
