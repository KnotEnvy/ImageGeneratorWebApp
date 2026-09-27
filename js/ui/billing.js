import { ApiError, completeMockCheckout, getBillingStatus, openBillingPortal, startCheckout } from '../api.js';
import { formatDate, html, pluralize, raw, showToast, wireDialogClose } from './dom.js';

/**
 * "Get more credits" dialog plus the Stripe Checkout round trip. Prices shown come from the
 * server's billing status so the page never hardcodes what Stripe charges.
 */
export function createBilling({ dialog, onCreditsChanged }) {
    const content = dialog.querySelector('#paywall-content');
    wireDialogClose(dialog);

    content.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-checkout]');
        if (!button) return;

        const originalText = button.innerHTML;
        content.querySelectorAll('button[data-checkout]').forEach((candidate) => { candidate.disabled = true; });
        button.textContent = 'Opening secure checkout…';
        try {
            const { url } = await startCheckout(button.dataset.checkout, button.dataset.pack);
            window.location.assign(url);
        } catch (error) {
            showToast(friendlyBillingError(error), 'error');
            content.querySelectorAll('button[data-checkout]').forEach((candidate) => { candidate.disabled = false; });
            button.innerHTML = originalText;
        }
    });

    async function open({ reason = 'topup', needed = 0 } = {}) {
        content.innerHTML = '<p class="dialog-copy" style="padding:40px 0;text-align:center">Loading options…</p>';
        if (!dialog.open) dialog.showModal();

        let billing;
        try {
            billing = (await getBillingStatus()).billing;
        } catch (error) {
            content.innerHTML = html`
                <button class="dialog-close" type="button" data-close aria-label="Close">&times;</button>
                <h2 class="dialog-title">Credits</h2>
                <p class="dialog-copy">${error.message}</p>
            `;
            return;
        }

        render(billing, { reason, needed });
    }

    function render(billing, { reason, needed }) {
        const credits = billing.credits;
        const outOfCredits = reason === 'insufficient';
        const offer = billing.subscriptionOffer;
        const anyPurchase = offer.available || billing.creditPacks.some((pack) => pack.available);
        const refill = credits.refreshesAt
            ? `Your ${credits.allowanceSource === 'subscription' ? 'monthly' : 'free'} credits refill on ${formatDate(credits.refreshesAt, { month: 'long', day: 'numeric' })}.`
            : '';

        const title = outOfCredits ? 'You\'re out of credits' : 'Get more credits';
        const copy = outOfCredits
            ? `This image needs ${pluralize(needed, 'credit')} and you have ${credits.balance}. Top up or subscribe to keep creating.`
            : `You have ${pluralize(credits.balance, 'credit')}. Each image costs 1 to 4 credits depending on the engine.`;

        content.innerHTML = html`
            <button class="dialog-close" type="button" data-close aria-label="Close">&times;</button>
            <h2 class="dialog-title" id="paywall-title">${title}</h2>
            <p class="dialog-copy">${copy} ${refill}</p>

            <div class="offer-grid">
                <div class="offer">
                    <span class="offer-eyebrow">Pay as you go</span>
                    <h3>Credit packs</h3>
                    <p>One-time purchase. Credits never expire.</p>
                    <div class="pack-list">
                        ${billing.creditPacks.map((pack) => raw(html`
                            <button class="pack-btn" type="button" data-checkout="credit_pack" data-pack="${pack.id}" ${pack.available ? '' : 'disabled'}>
                                <div>
                                    <strong>${pluralize(pack.credits, 'credit')}</strong><br>
                                    <span>${pack.label}</span>
                                </div>
                                <span class="pack-price">${pack.priceLabel}</span>
                            </button>
                        `))}
                    </div>
                </div>

                <div class="offer featured">
                    <span class="offer-eyebrow">Best value</span>
                    <h3>${offer.label} plan</h3>
                    <p>${offer.monthlyCredits} credits every month for regular creators.</p>
                    <div class="offer-price">${offer.priceLabel}</div>
                    <ul>
                        <li>${offer.monthlyCredits} fresh credits each billing month</li>
                        <li>Every engine, including the premium ones</li>
                        <li>Cancel anytime from Manage billing</li>
                    </ul>
                    ${offer.active
                        ? raw(html`<button class="btn btn-ghost btn-block" type="button" data-portal>You're subscribed · Manage billing</button>`)
                        : raw(html`<button class="btn btn-primary btn-block" type="button" data-checkout="subscription" ${offer.available ? '' : 'disabled'}>Subscribe</button>`)}
                </div>
            </div>

            <p class="fine-print">
                ${anyPurchase ? 'Payments are handled securely by Stripe. Promo codes can be entered at checkout.' : 'Purchases are not switched on for this beta yet. Contact the person who invited you if you need more credits.'}
            </p>
        `;

        content.querySelector('[data-portal]')?.addEventListener('click', () => openPortal());
    }

    async function openPortal() {
        try {
            const { url } = await openBillingPortal();
            window.location.assign(url);
        } catch (error) {
            showToast(friendlyBillingError(error), 'error');
        }
    }

    /**
     * Handle the redirect back from Checkout (or the local mock checkout) and clean the URL.
     * Returns true when the URL carried a billing result.
     */
    async function handleReturn() {
        const url = new URL(window.location.href);
        const params = url.searchParams;
        const mockSession = params.get('mock_checkout_session');
        const result = params.get('billing');
        const mockPortal = params.get('mock_billing_portal');
        if (!mockSession && !result && !mockPortal) return false;

        for (const key of ['mock_checkout_session', 'billing', 'kind', 'session_id', 'mock_billing_portal']) {
            params.delete(key);
        }
        window.history.replaceState({}, '', `${url.pathname}${params.toString() ? `?${params}` : ''}${url.hash}`);

        if (mockSession) {
            try {
                const response = await completeMockCheckout(mockSession);
                onCreditsChanged(response.user);
                showToast('Test payment complete. Your credits have been added.', 'success', { duration: 6000 });
            } catch (error) {
                showToast(`Test checkout failed: ${error.message}`, 'error');
            }
        } else if (mockPortal) {
            showToast('This is where Stripe\'s billing page would open (test mode).', 'info');
        } else if (result === 'success') {
            showToast('Thank you! Your credits will appear in a moment.', 'success', { duration: 6000 });
            pollForCredits();
        } else if (result === 'cancel') {
            showToast('Checkout canceled. You have not been charged.', 'info');
        }
        return true;
    }

    // Stripe confirms payment through a webhook, which can land a few seconds after the redirect.
    async function pollForCredits() {
        let startingBalance = null;
        for (let attempt = 0; attempt < 8; attempt += 1) {
            try {
                const { billing } = await getBillingStatus();
                if (startingBalance === null) startingBalance = billing.credits.balance;
                onCreditsChanged(null, billing);
                if (attempt > 0 && billing.credits.balance !== startingBalance) return;
            } catch {
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 2500));
        }
    }

    return { open, openPortal, handleReturn };
}

function friendlyBillingError(error) {
    if (error instanceof ApiError) {
        if (error.code === 'stripe_not_configured') return 'Purchases are not switched on yet.';
        if (error.code === 'auth_required') return 'Please sign in first.';
        if (error.code === 'stripe_customer_missing') return 'There is no billing history for this account yet.';
    }
    return error.message || 'Something went wrong opening checkout.';
}
