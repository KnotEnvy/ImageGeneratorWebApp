import {
    ApiError,
    login,
    logout,
    requestEmailVerification,
    requestPasswordReset,
    resetPassword,
    signUp,
    verifyEmail
} from '../api.js';
import { formatDate, html, pluralize, raw, showToast, wireDialogClose } from './dom.js';

/**
 * Sign-in / sign-up dialog, emailed-link handling, and the account page.
 * `onSession(user)` is called whenever the signed-in user changes.
 */
export function createAccount({ authDialog, resetDialog, accountContainer, onSession, getContext, openPaywall, openPortal }) {
    const form = authDialog.querySelector('#auth-form');
    const title = authDialog.querySelector('#auth-title');
    const copy = authDialog.querySelector('#auth-copy');
    const email = authDialog.querySelector('#auth-email');
    const password = authDialog.querySelector('#auth-password');
    const errorText = authDialog.querySelector('#auth-error');
    const submit = authDialog.querySelector('#auth-submit');
    const switchButton = authDialog.querySelector('#auth-switch');
    const forgotButton = authDialog.querySelector('#auth-forgot');
    let mode = 'signup';
    let afterSignIn = null;
    let pendingResetToken = '';

    wireDialogClose(authDialog);
    wireDialogClose(resetDialog);

    function setMode(nextMode) {
        mode = nextMode;
        const { freeMonthlyCredits } = getContext();
        const signup = mode === 'signup';
        title.textContent = signup ? 'Create your free account' : 'Welcome back';
        copy.textContent = signup
            ? `Start with ${pluralize(freeMonthlyCredits || 0, 'free credit')}${freeMonthlyCredits ? ' to create with' : ''}. No card needed.`
            : 'Sign in to keep creating and see your saved art.';
        submit.textContent = signup ? 'Create free account' : 'Sign in';
        password.autocomplete = signup ? 'new-password' : 'current-password';
        switchButton.textContent = signup ? 'Already have an account? Sign in' : 'New here? Create a free account';
        forgotButton.hidden = signup;
        errorText.textContent = '';
    }

    function open({ mode: requestedMode = 'signup', then = null, message = '' } = {}) {
        afterSignIn = then;
        setMode(requestedMode);
        if (message) copy.textContent = message;
        if (!authDialog.open) authDialog.showModal();
        requestAnimationFrame(() => email.focus());
    }

    switchButton.addEventListener('click', () => setMode(mode === 'signup' ? 'login' : 'signup'));

    forgotButton.addEventListener('click', async () => {
        if (!email.value.trim()) {
            errorText.textContent = 'Enter your email above, then choose "Forgot password" again.';
            email.focus();
            return;
        }
        try {
            await requestPasswordReset(email.value.trim());
            errorText.textContent = '';
            showToast('If that email has an account, a reset link is on its way.', 'success', { duration: 6000 });
        } catch (error) {
            errorText.textContent = error.message;
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorText.textContent = '';
        if (!email.value.trim() || !email.validity.valid) {
            errorText.textContent = 'Please enter a valid email address.';
            email.focus();
            return;
        }
        if (password.value.length < 8) {
            errorText.textContent = 'Passwords need at least 8 characters.';
            password.focus();
            return;
        }

        submit.disabled = true;
        try {
            const response = mode === 'signup'
                ? await signUp(email.value.trim(), password.value)
                : await login(email.value.trim(), password.value);
            password.value = '';
            authDialog.close();
            onSession(response.user);
            showToast(mode === 'signup'
                ? `Welcome! You have ${pluralize(response.user.credits.balance, 'credit')} to start.`
                : 'Signed in.', 'success');
            if (mode === 'signup' && response.user.emailVerificationRequired && !response.user.emailVerified) {
                showToast('Check your inbox to verify your email before creating.', 'info', { duration: 7000 });
            }
            const next = afterSignIn;
            afterSignIn = null;
            next?.(response.user);
        } catch (error) {
            errorText.textContent = error instanceof ApiError && error.code === 'account_exists'
                ? 'That email already has an account. Try signing in instead.'
                : error.message;
        } finally {
            submit.disabled = false;
        }
    });

    resetDialog.querySelector('#reset-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const input = resetDialog.querySelector('#reset-password');
        const resetError = resetDialog.querySelector('#reset-error');
        if (input.value.length < 8) {
            resetError.textContent = 'Passwords need at least 8 characters.';
            return;
        }
        try {
            await resetPassword(pendingResetToken, input.value);
            pendingResetToken = '';
            input.value = '';
            resetDialog.close();
            showToast('Password updated. Please sign in with your new password.', 'success');
            open({ mode: 'login' });
        } catch (error) {
            resetError.textContent = error.message;
        }
    });

    /** Handle ?verify_email= and ?reset_password= links from emails, then clean the URL. */
    async function handleEmailLinks() {
        const url = new URL(window.location.href);
        const verifyToken = url.searchParams.get('verify_email');
        const resetToken = url.searchParams.get('reset_password');
        if (!verifyToken && !resetToken) return;

        url.searchParams.delete('verify_email');
        url.searchParams.delete('reset_password');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);

        if (verifyToken) {
            try {
                const response = await verifyEmail(verifyToken);
                if (response.user) onSession(response.user);
                showToast('Email verified. You\'re all set to create!', 'success');
            } catch (error) {
                showToast(error.message, 'error');
            }
        }

        if (resetToken) {
            pendingResetToken = resetToken;
            resetDialog.showModal();
        }
    }

    function renderAccountPage() {
        const { user, billing } = getContext();
        if (!user) {
            accountContainer.innerHTML = html`
                <div class="empty-state">
                    <h2>You're not signed in</h2>
                    <p>Sign in to see your credits and saved art.</p>
                    <button class="btn btn-primary" type="button" data-account-action="signin">Sign in</button>
                </div>
            `;
            return;
        }

        const credits = user.credits;
        const subscribed = user.plan === 'pro';
        const refillLabel = credits.refreshesAt ? formatDate(credits.refreshesAt, { month: 'long', day: 'numeric' }) : null;

        accountContainer.innerHTML = html`
            <div class="page-header">
                <div>
                    <h1 class="page-title">Account</h1>
                    <p class="page-subtitle">${user.email}</p>
                </div>
            </div>

            <div class="card">
                <h2>Credits</h2>
                <div class="balance"><strong>${credits.balance}</strong><span>${credits.balance === 1 ? 'credit' : 'credits'} available</span></div>
                <div class="kv"><span>${subscribed ? `${user.planLabel} monthly credits` : 'Free monthly credits'}</span><strong>${credits.allowance} of ${credits.monthlyAllowance}</strong></div>
                ${refillLabel ? raw(html`<div class="kv"><span>Refills on</span><strong>${refillLabel}</strong></div>`) : ''}
                <div class="kv"><span>Purchased credits (never expire)</span><strong>${credits.purchased}</strong></div>
                <div class="button-row">
                    <button class="btn btn-primary" type="button" data-account-action="buy">Get more credits</button>
                    ${billing?.portalAvailable || user.subscription?.billingCustomerId ? raw('<button class="btn btn-ghost" type="button" data-account-action="portal">Manage billing &amp; receipts</button>') : ''}
                </div>
            </div>

            <div class="card">
                <h2>Plan</h2>
                <div class="kv"><span>Current plan</span><strong>${user.planLabel}</strong></div>
                ${subscribed && user.subscription?.currentPeriodEnd ? raw(html`<div class="kv"><span>Renews</span><strong>${formatDate(user.subscription.currentPeriodEnd)}</strong></div>`) : ''}
            </div>

            <div class="card">
                <h2>Sign-in</h2>
                <div class="kv"><span>Email</span><strong>${user.email}</strong></div>
                <div class="kv"><span>Email status</span>${user.emailVerified
                    ? raw('<strong class="status-good">Verified</strong>')
                    : raw('<strong class="status-warn">Not verified</strong>')}</div>
                <div class="button-row">
                    ${!user.emailVerified && user.emailVerificationRequired ? raw('<button class="btn btn-soft" type="button" data-account-action="verify">Resend verification email</button>') : ''}
                    <button class="btn btn-ghost" type="button" data-account-action="reset">Change password</button>
                    <button class="btn btn-danger" type="button" data-account-action="signout">Sign out</button>
                </div>
            </div>
        `;
    }

    accountContainer.addEventListener('click', async (event) => {
        const action = event.target.closest('[data-account-action]')?.dataset.accountAction;
        if (!action) return;
        const { user } = getContext();

        if (action === 'signin') open({ mode: 'login' });
        if (action === 'buy') openPaywall();
        if (action === 'portal') openPortal();
        if (action === 'verify') {
            try {
                await requestEmailVerification();
                showToast('Verification email sent. Check your inbox.', 'success');
            } catch (error) {
                showToast(error.message, 'error');
            }
        }
        if (action === 'reset' && user) {
            try {
                await requestPasswordReset(user.email);
                showToast('We emailed you a link to choose a new password.', 'success', { duration: 6000 });
            } catch (error) {
                showToast(error.message, 'error');
            }
        }
        if (action === 'signout') {
            try {
                await logout();
            } finally {
                onSession(null);
                showToast('Signed out.', 'info');
            }
        }
    });

    return { open, renderAccountPage, handleEmailLinks };
}
