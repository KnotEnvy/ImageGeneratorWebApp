import { getAdminJobs, getAdminPolicyEvents, getAdminReports, getAdminSummary, grantAdminCredits } from '../api.js';
import { html, raw, showToast } from './dom.js';

/**
 * Operator dashboard at #admin. The admin token is held in memory only and never persisted.
 */
export function createAdmin({ container }) {
    let token = '';

    function render() {
        if (!token) {
            container.innerHTML = html`
                <div class="page-header">
                    <div>
                        <h1 class="page-title">Admin</h1>
                        <p class="page-subtitle">Usage, credits, jobs, and reports. Requires the server's ADMIN_API_TOKEN.</p>
                    </div>
                </div>
                <form class="card" data-admin-form="connect" style="max-width:520px">
                    <label class="label" for="admin-token-input" style="margin-top:0">Admin token</label>
                    <input class="field" id="admin-token-input" type="password" autocomplete="off">
                    <button class="btn btn-primary" type="submit" style="margin-top:14px">Connect</button>
                </form>
            `;
            return;
        }
        load();
    }

    async function load() {
        container.innerHTML = '<p class="page-subtitle" style="padding:40px 0">Loading dashboard…</p>';
        try {
            const [summary, jobs, reports, policy] = await Promise.all([
                getAdminSummary(token),
                getAdminJobs(token),
                getAdminReports(token),
                getAdminPolicyEvents(token)
            ]);
            renderDashboard(summary.summary, jobs.jobs, reports.reports, policy.events);
        } catch (error) {
            token = '';
            render();
            showToast(`Admin: ${error.message}`, 'error');
        }
    }

    function renderDashboard(summary, jobs, reports, events) {
        const totals = summary.totals;
        const metrics = [
            ['Accounts', totals.users],
            ['Subscribers', totals.paidSubscribers],
            ['Images made', totals.generationJobs],
            ['Saved in galleries', totals.galleryItems],
            ['Credits spent this month', summary.credits.spentThisMonth],
            ['Credits purchased this month', summary.credits.purchasedThisMonth],
            ['Failed jobs', summary.jobsByStatus.failed || 0],
            ['Open reports', summary.abuseReports.byStatus.open || 0]
        ];

        container.innerHTML = html`
            <div class="page-header">
                <div>
                    <h1 class="page-title">Admin</h1>
                    <p class="page-subtitle">Month ${summary.usage.month}</p>
                </div>
                <button class="btn btn-ghost" type="button" data-admin-action="refresh">Refresh</button>
            </div>

            <div class="metric-grid">
                ${metrics.map(([label, value]) => raw(html`<div class="metric"><span>${label}</span><strong>${value ?? 0}</strong></div>`))}
            </div>

            <form class="card" data-admin-form="grant">
                <h2>Give credits</h2>
                <p class="hint">Adds purchased credits (they never expire) to a tester's account.</p>
                <div class="form-grid" style="margin-top:12px">
                    <input class="field" name="email" type="email" placeholder="tester@example.com" required>
                    <input class="field" name="credits" type="number" min="1" max="100000" value="50" required>
                </div>
                <input class="field" name="note" type="text" placeholder="Note (optional), e.g. beta thank-you" style="margin-top:10px">
                <button class="btn btn-primary" type="submit" style="margin-top:12px">Give credits</button>
            </form>

            <div class="admin-grid">
                <section class="card">
                    <h2>Recent images</h2>
                    ${rows(jobs, (job) => [`${job.status} · ${job.model}`, `${formatTime(job.createdAt)}${job.errorCode ? ` · ${job.errorCode}` : ''}`], 'No jobs yet.')}
                </section>
                <section class="card">
                    <h2>Reports</h2>
                    ${rows(reports, (report) => [`${report.reason} · ${report.targetType}`, `${report.status} · ${formatTime(report.createdAt)}${report.details ? ` · ${report.details}` : ''}`], 'No reports.')}
                </section>
                <section class="card">
                    <h2>Blocked prompts</h2>
                    ${rows(events, (event) => [`${event.policyCode} · ${event.surface}`, `${formatTime(event.createdAt)} · ${event.textExcerpt || ''}`], 'Nothing blocked.')}
                </section>
            </div>
        `;
    }

    function rows(items, describe, emptyText) {
        if (!items.length) return raw(html`<p class="hint">${emptyText}</p>`);
        return raw(items.map((item) => {
            const [title, detail] = describe(item);
            return html`<div class="admin-row"><strong>${title}</strong><span>${detail}</span></div>`;
        }).join(''));
    }

    container.addEventListener('submit', async (event) => {
        const formName = event.target.dataset.adminForm;
        if (!formName) return;
        event.preventDefault();

        if (formName === 'connect') {
            token = container.querySelector('#admin-token-input').value.trim();
            if (!token) {
                showToast('Enter the admin token.', 'error');
                return;
            }
            render();
        }

        if (formName === 'grant') {
            const data = new FormData(event.target);
            try {
                const { grant } = await grantAdminCredits(token, {
                    email: data.get('email'),
                    credits: Number(data.get('credits')),
                    note: data.get('note')
                });
                showToast(`Gave ${grant.creditsGranted} credits to ${grant.email}. New balance: ${grant.credits.balance}.`, 'success', { duration: 6000 });
                event.target.reset();
            } catch (error) {
                showToast(error.message, 'error');
            }
        }
    });

    container.addEventListener('click', (event) => {
        if (event.target.closest('[data-admin-action="refresh"]')) load();
    });

    return { render };
}

function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
