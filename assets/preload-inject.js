

;/* antigravity-model-patch: vendor-runtime-v1 */

(() => {
const exports = {};
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/** Custom-model UI, appended to the vendor preload. Sandboxed preloads require Electron only. */
const electron_1 = require("electron");
const storageAPI = {
    getCustomModels: () => electron_1.ipcRenderer.invoke('storage:get-custom-models'),
    saveCustomModel: (model) => electron_1.ipcRenderer.invoke('storage:save-custom-model', model),
    deleteCustomModel: (name) => electron_1.ipcRenderer.invoke('storage:delete-custom-model', name),
    testModelConnection: (model) => electron_1.ipcRenderer.invoke('storage:test-model-connection', model),
    testModelGeneration: (model) => electron_1.ipcRenderer.invoke('storage:test-model-generation', model),
    getPresets: () => electron_1.ipcRenderer.invoke('storage:get-provider-presets'),
    discoverModels: (params) => electron_1.ipcRenderer.invoke('storage:discover-models', params),
};
window.addEventListener('DOMContentLoaded', () => {
    let modelList = [];
    let renderVersion = 0;
    let searchTerm = '';
    let cancelModalOperation;
    const requireSuccess = (result) => {
        if (!result?.success)
            throw new Error(result?.error || 'The operation could not be completed.');
        return result;
    };
    function element(tag, className = '', text = '') {
        const node = document.createElement(tag);
        node.className = className;
        if (text)
            node.textContent = text;
        return node;
    }
    function setStatus(target, text, error = false) {
        target.textContent = text;
        target.className = `agy-status${error ? ' agy-error' : ''}`;
    }
    function statusNode() {
        const node = element('div', 'agy-status');
        node.setAttribute('role', 'status');
        node.setAttribute('aria-live', 'polite');
        return node;
    }
    function button(label, action, status, primary = false) {
        const node = element('button', `agy-btn${primary ? ' agy-primary' : ''}`, label);
        node.type = 'button';
        node.addEventListener('click', async () => {
            // Fleet saves read and replace complete model records. Other settings
            // actions must not submit an older record while that transaction is pending.
            if (node.disabled || fleetBusy)
                return;
            node.disabled = true;
            try {
                await action();
            }
            catch (error) {
                const target = status || document.getElementById('agy-main-status');
                if (target)
                    setStatus(target, error instanceof Error ? error.message : String(error), true);
            }
            finally {
                node.disabled = false;
            }
        });
        return node;
    }
    function field(parent, title, id, value = '', type = 'text') {
        const label = element('label', 'agy-field');
        label.htmlFor = id;
        label.append(element('span', '', title));
        const input = element('input');
        input.id = id;
        input.type = type;
        input.value = value;
        input.autocomplete = 'off';
        label.append(input);
        parent.append(label);
        return input;
    }
    function selectField(parent, title, id, options, value) {
        const label = element('label', 'agy-field');
        label.htmlFor = id;
        label.append(element('span', '', title));
        const select = element('select');
        select.id = id;
        for (const [key, caption] of options) {
            const option = element('option', '', caption);
            option.value = key;
            select.append(option);
        }
        select.value = value;
        label.append(select);
        parent.append(label);
        return select;
    }
    function jsonField(parent, title, id, value) {
        const label = element('label', 'agy-field');
        label.htmlFor = id;
        label.append(element('span', '', title));
        const input = element('textarea');
        input.id = id;
        input.rows = 3;
        input.spellcheck = false;
        input.value = value ? JSON.stringify(value, null, 2) : '';
        input.placeholder = '{}';
        label.append(input);
        parent.append(label);
        return input;
    }
    function textAreaField(parent, title, id, value, placeholder) {
        const label = element('label', 'agy-field');
        label.htmlFor = id;
        label.append(element('span', '', title));
        const input = element('textarea');
        input.id = id;
        input.rows = 3;
        input.value = typeof value === 'string' ? value : '';
        input.placeholder = placeholder;
        label.append(input);
        parent.append(label);
        return input;
    }
    function readJson(input, title) {
        if (!input.value.trim())
            return undefined;
        try {
            const value = JSON.parse(input.value);
            if (!value || Array.isArray(value) || typeof value !== 'object')
                throw new Error();
            return value;
        }
        catch {
            throw new Error(`${title} must be a JSON object.`);
        }
    }
    function readNumber(input, title, minimum = 0) {
        if (!input.value.trim())
            return undefined;
        const value = Number(input.value);
        if (!Number.isSafeInteger(value) || value < minimum)
            throw new Error(`${title} must be a whole number of at least ${minimum}.`);
        return value;
    }
    function validUrl(value) {
        let url;
        try {
            url = new URL(value.trim());
        }
        catch {
            throw new Error('Enter a complete http:// or https:// API URL.');
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            throw new Error('Use an HTTP or HTTPS URL. Enter credentials in the API key field.');
        return value.trim();
    }
    function installStyles() {
        if (document.getElementById('agy-manager-style'))
            return;
        const style = element('style');
        style.id = 'agy-manager-style';
        style.textContent = `
      #agy-custom-models-section,#agy-modal-overlay{font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e4e4e7;box-sizing:border-box}
      #agy-custom-models-section *,#agy-modal-overlay *{box-sizing:border-box}
      #agy-custom-models-section [hidden],#agy-modal-overlay [hidden]{display:none!important}
      #agy-custom-models-section{margin:24px 0;padding:20px;border:1px solid #303036;border-radius:12px;background:#18181b;min-width:0}
      #agy-custom-models-section h2,#agy-modal-overlay h2{font-size:18px;margin:0;color:#fafafa;font-weight:600}
      #agy-custom-models-section h3{font-size:13px;margin:0;color:#f4f4f5}
      .agy-toolbar,.agy-actions,.agy-group-heading,.agy-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .agy-toolbar{justify-content:space-between;margin-bottom:12px}.agy-actions{margin:10px 0}
      .agy-muted{color:#a1a1aa;font-size:12px;overflow-wrap:anywhere}.agy-group{margin-top:16px;border-top:1px solid #303036;padding-top:14px}
      .agy-group-heading{justify-content:space-between}.agy-row{justify-content:space-between;border:1px solid #303036;border-radius:8px;padding:12px;margin-top:8px;background:#202024}
      .agy-row-info{flex:1;min-width:150px;overflow-wrap:anywhere}.agy-row[data-enabled="false"] .agy-row-info{opacity:.55}
      #agy-custom-models-section .agy-btn,#agy-modal-overlay .agy-btn{appearance:none;font:inherit;color:#e4e4e7;background:#27272c;border:1px solid #414149;border-radius:6px;padding:6px 10px;cursor:pointer;white-space:nowrap}
      #agy-custom-models-section .agy-primary,#agy-modal-overlay .agy-primary{background:#e4e4e7;color:#18181b;border-color:#e4e4e7;font-weight:600}
      #agy-custom-models-section .agy-btn:hover,#agy-modal-overlay .agy-btn:hover{filter:brightness(1.12)}
      #agy-custom-models-section .agy-btn:disabled,#agy-modal-overlay .agy-btn:disabled{opacity:.5;cursor:wait}
      #agy-custom-models-section :focus-visible,#agy-modal-overlay :focus-visible{outline:2px solid #a78bfa;outline-offset:3px}
      .agy-status{color:#86efac;font-size:12px;margin-top:8px;white-space:pre-wrap;overflow-wrap:anywhere}.agy-status:empty{display:none}.agy-error{color:#fca5a5}
      .agy-field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px;min-width:0;color:#a1a1aa}
      #agy-custom-models-section input,#agy-modal-overlay input,#agy-modal-overlay select,#agy-modal-overlay textarea{font:inherit;width:100%;background:#25252a;border:1px solid #414149;border-radius:6px;color:#fafafa;padding:8px 10px;min-width:0}
      #agy-modal-overlay textarea{font-family:ui-monospace,monospace;resize:vertical}#agy-modal-overlay input[type=checkbox]{width:auto;accent-color:#a78bfa}
      #agy-modal-overlay{position:fixed;inset:0;z-index:999999;background:#000a;display:flex;align-items:center;justify-content:center;padding:20px}
      #agy-modal-card{width:680px;max-width:100%;max-height:90vh;overflow:auto;background:#18181b;border:1px solid #414149;border-radius:12px;padding:24px;box-shadow:0 24px 80px #0008}
      .agy-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}.agy-discovery{max-height:240px;overflow:auto;margin:12px 0}
      .agy-choice{display:flex;gap:10px;align-items:center;padding:7px 0;overflow-wrap:anywhere}.agy-choice span{min-width:0}
      #agy-modal-overlay details{border:1px solid #303036;border-radius:8px;margin:12px 0;padding:12px}#agy-modal-overlay summary{cursor:pointer;margin-bottom:10px;font-weight:500}
      .agy-fleet{margin:18px 0;border:1px solid #303036;border-radius:10px;padding:14px;min-width:0}.agy-fleet-table{width:100%;border-collapse:separate;border-spacing:0 12px;text-align:left;table-layout:fixed}.agy-fleet-table td{padding:0}.agy-fleet-card{background:#202024;border:1px solid #3f3f46;border-radius:10px;padding:16px;min-width:0}.agy-fleet-card-header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.agy-fleet-card-header .agy-actions{margin:0}.agy-fleet-label{font-size:14px;font-weight:600;overflow-wrap:anywhere}.agy-fleet-pools{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px;margin-top:14px}.agy-fleet-pool{border:1px solid #303036;border-radius:8px;padding:12px;background:#18181b;min-width:0}.agy-fleet-pool .agy-actions{margin-bottom:0}.agy-fleet-account-state{margin-top:5px}.agy-pool-badge{display:inline-block;padding:2px 6px;border-radius:5px;background:#27272c;color:#a1a1aa;font-size:11px}.agy-pool-preferred,.agy-plan-pro{color:#86efac}.agy-pool-disabled{color:#fca5a5}.agy-fleet-quotas{display:grid;gap:10px;margin:12px 0}.agy-quota-group{display:grid;gap:8px}.agy-quota-group-title{font-size:11px;font-weight:600;color:#d4d4d8}.agy-quota-bucket{min-width:0}.agy-quota-heading{display:flex;justify-content:space-between;gap:8px;font-size:12px;flex-wrap:wrap}.agy-quota-bucket progress{display:block;width:100%;height:7px;margin:5px 0;accent-color:#86efac}.agy-quota-bucket[data-exhausted="true"] progress{accent-color:#f87171}.agy-quota-bucket[data-exhausted="true"] .agy-quota-value{color:#fca5a5}.agy-quota-reset{font-size:11px;color:#a1a1aa}.agy-fleet-fallback{display:flex;align-items:center;gap:8px;font-size:12px}.agy-fleet-fallback input{width:auto!important;accent-color:#86efac}.agy-fleet-details[hidden]{display:none}
      #agy-fleet-target-pool{font:inherit;color:#fafafa;background:#25252a;border:1px solid #414149;border-radius:6px;padding:6px;max-width:240px}#agy-fleet-target-pool option{background:#25252a;color:#fafafa}
      .agy-model-search-box{padding:6px 8px}.agy-model-search-input{box-sizing:border-box;width:100%;font:inherit;color:inherit;background:transparent;border:1px solid #52525b;border-radius:5px;padding:6px}.agy-model-no-results{padding:8px;color:#a1a1aa;font-size:12px}
      @media(max-width:600px){.agy-grid{grid-template-columns:1fr}#agy-modal-card{padding:16px}.agy-row .agy-actions{width:100%}}
    `;
        document.head.append(style);
    }
    function openModal(title) {
        cancelModalOperation?.();
        cancelModalOperation = undefined;
        document.getElementById('agy-modal-overlay')?.remove();
        const previousFocus = document.activeElement;
        const overlay = element('div');
        overlay.id = 'agy-modal-overlay';
        const card = element('div');
        card.id = 'agy-modal-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.setAttribute('aria-labelledby', 'agy-modal-title');
        const header = element('div', 'agy-toolbar');
        const heading = element('h2', '', title);
        heading.id = 'agy-modal-title';
        const close = () => {
            if (!overlay.isConnected)
                return;
            cancelModalOperation?.();
            cancelModalOperation = undefined;
            overlay.remove();
            if (previousFocus?.isConnected)
                previousFocus.focus({ preventScroll: true });
        };
        header.append(heading, button('Close', close));
        const body = element('div');
        const status = statusNode();
        card.append(header, body, status);
        overlay.append(card);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay)
                close();
        });
        overlay.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
            if (event.key !== 'Tab')
                return;
            const controls = Array.from(card.querySelectorAll('button:not(:disabled),input:not(:disabled),select,textarea,summary'));
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            }
            else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        });
        document.body.append(overlay);
        header.querySelector('button')?.focus();
        return { body, status, close };
    }
    function createGoogleAccountPanel(parent, initialAccounts, modelName) {
        let accounts = initialAccounts.map((account) => ({ ...account }));
        const locallyEdited = new Set();
        let accountOperationAttempt = 0;
        let accountOperationPending = false;
        const panel = element('details');
        panel.open = true;
        panel.append(element('summary', '', 'Google accounts'));
        panel.append(element('p', 'agy-muted', 'Add up to 50 accounts you own using Antigravity sign-in, your Desktop OAuth client, or a credential file. Save the model to retain changes. Existing secrets stay masked. Prepare account checks the Cloud Code project and may activate the available free tier.'));
        const list = element('div');
        list.id = 'agy-google-accounts-list';
        const editor = element('div');
        const status = statusNode();
        const randomId = () => `account-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const addAccount = (account) => {
            if (!account.id || (!account.refreshToken && !account.accessToken))
                throw new Error('An account needs an ID and a refresh token or access token.');
            if (account.refreshToken && !account.clientId)
                throw new Error('An OAuth client ID is required with a refresh token.');
            const index = accounts.findIndex((value) => value.id === account.id);
            if (index < 0) {
                if (accounts.length >= 50)
                    throw new Error('A model can contain at most 50 Google accounts.');
                accounts.push(account);
            }
            else
                accounts[index] = account;
            locallyEdited.add(account.id);
            renderAccounts();
        };
        function editAccount(account) {
            editor.replaceChildren();
            editor.append(element('h3', '', account ? 'Edit account' : 'Add account credentials'));
            const accountGrid = element('div', 'agy-grid');
            const id = field(accountGrid, 'Account ID', 'agy-account-id', account?.id || randomId());
            const label = field(accountGrid, 'Label', 'agy-account-label', account?.label || '');
            const clientId = field(accountGrid, 'Desktop OAuth client ID', 'agy-account-client-id', account?.clientId || '');
            const clientSecret = field(accountGrid, 'OAuth client secret (if required)', 'agy-account-client-secret', account?.clientSecret || '', 'password');
            const refresh = field(accountGrid, 'Refresh token', 'agy-account-refresh-token', account?.refreshToken || '', 'password');
            const access = field(accountGrid, 'Access token (optional with refresh token)', 'agy-account-access-token', account?.accessToken || '', 'password');
            const expires = field(accountGrid, 'Access token expiry (Unix milliseconds)', 'agy-account-expires-at', account?.expiresAt != null ? String(account.expiresAt) : '', 'number');
            const project = field(accountGrid, 'Cloud project (optional)', 'agy-account-project', account?.project || '');
            editor.append(accountGrid);
            const actions = element('div', 'agy-actions');
            actions.append(button('Apply account', () => {
                const accountId = id.value.trim();
                if (account && accountId !== account.id && accounts.some((value) => value.id === accountId))
                    throw new Error('That account ID already exists.');
                const updated = {
                    id: accountId,
                    label: label.value.trim(),
                    clientId: clientId.value.trim(),
                    clientSecret: clientSecret.value.trim(),
                    refreshToken: refresh.value.trim(),
                    accessToken: access.value.trim(),
                    expiresAt: readNumber(expires, 'Token expiry', 1),
                    project: project.value.trim(),
                    authMode: account?.authMode,
                    cloudCodeEndpoint: account?.cloudCodeEndpoint,
                    enabled: account?.enabled !== false,
                };
                // IDs bind masked secrets to their stored record, so changing an existing ID requires fresh credentials.
                if (account &&
                    accountId !== account.id &&
                    [updated.refreshToken, updated.accessToken, updated.clientSecret].some((value) => value?.includes('***')))
                    throw new Error('Keep the account ID unchanged when using masked credentials.');
                addAccount(updated);
                if (account && accountId !== account.id)
                    accounts = accounts.filter((value) => value.id !== account.id);
                editor.replaceChildren();
                renderAccounts();
                setStatus(status, 'Account updated. Save the model to keep these changes.');
            }, status), button('Cancel account edit', () => editor.replaceChildren(), status));
            editor.append(actions);
        }
        function renderAccounts() {
            list.replaceChildren();
            if (!accounts.length)
                list.append(element('p', 'agy-muted', 'No Google accounts configured.'));
            for (const account of accounts) {
                const row = element('div', 'agy-row');
                const info = element('div', 'agy-row-info');
                info.append(element('strong', '', account.label || account.id), element('div', 'agy-muted', `${account.id} · ${account.enabled === false ? 'Disabled' : 'Enabled'}${account.project ? ` · ${account.project}` : ''}`));
                const actions = element('div', 'agy-actions');
                actions.append(button('Edit account', () => editAccount(account), status), button(account.enabled === false ? 'Enable account' : 'Disable account', () => {
                    account.enabled = account.enabled === false;
                    renderAccounts();
                }, status), button('Test account', async () => {
                    setStatus(status, 'Checking account access and quota…');
                    const result = await electron_1.ipcRenderer.invoke('storage:google-test-account', modelName && !locallyEdited.has(account.id)
                        ? { modelName, accountId: account.id }
                        : { account, ...(modelName ? { modelName } : {}) });
                    requireSuccess(result);
                    setStatus(status, result.message ||
                        (result.quota
                            ? `Account verified. Quota: ${JSON.stringify(result.quota)}`
                            : 'Account verified. Generation was not tested.'));
                }, status), button('Prepare account', async () => {
                    if (accountOperationPending)
                        throw new Error('Wait for the current Google account operation or cancel it.');
                    accountOperationPending = true;
                    const attempt = ++accountOperationAttempt;
                    const cancel = () => {
                        accountOperationAttempt++;
                        void electron_1.ipcRenderer.invoke('storage:google-login-cancel').catch(() => { });
                    };
                    cancelModalOperation = cancel;
                    try {
                        setStatus(status, 'Preparing account access and Cloud Code project…');
                        const result = await electron_1.ipcRenderer.invoke('storage:google-account-prepare', {
                            ...(modelName && !locallyEdited.has(account.id)
                                ? { modelName, accountId: account.id }
                                : { account, ...(modelName ? { modelName } : {}) }),
                            allowOnboard: true,
                        });
                        if (!panel.isConnected || accountOperationAttempt !== attempt)
                            return;
                        requireSuccess(result);
                        if (!accounts.some((value) => value.id === account.id))
                            return;
                        if (!result.account || result.account.id !== account.id)
                            throw new Error('Account preparation did not return the selected account.');
                        addAccount({ ...account, ...result.account });
                        setStatus(status, result.message ||
                            'Account prepared. Save the model to retain the project. Generation was not tested.');
                    }
                    finally {
                        accountOperationPending = false;
                        if (cancelModalOperation === cancel)
                            cancelModalOperation = undefined;
                    }
                }, status), button('Remove account', () => {
                    accounts = accounts.filter((value) => value.id !== account.id);
                    locallyEdited.delete(account.id);
                    renderAccounts();
                }, status));
                row.append(info, actions);
                list.append(row);
            }
        }
        const actions = element('div', 'agy-actions');
        actions.append(button('Add account', () => editAccount(), status), button('Pool status', async () => {
            const result = await electron_1.ipcRenderer.invoke('storage:google-pool-status');
            if (result?.success === false)
                requireSuccess(result);
            setStatus(status, JSON.stringify(result, null, 2));
        }, status));
        const login = element('details');
        login.append(element('summary', '', 'Sign in with Google'));
        const loginMode = selectField(login, 'Sign-in method', 'agy-google-login-auth-mode', [
            ['antigravity', 'Antigravity account'],
            ['custom', 'My Desktop OAuth client'],
        ], 'antigravity');
        const loginHelp = element('p', 'agy-muted');
        login.append(loginHelp);
        const loginLabel = field(login, 'Account label', 'agy-google-login-label');
        const loginClient = field(login, 'Desktop OAuth client ID', 'agy-google-login-client-id');
        const loginSecret = field(login, 'OAuth client secret (if required)', 'agy-google-login-client-secret', '', 'password');
        const updateLoginMode = () => {
            const native = loginMode.value === 'antigravity';
            loginClient.closest('label').hidden = native;
            loginSecret.closest('label').hidden = native;
            loginHelp.textContent = native
                ? 'Sign in through your browser using the installed Antigravity app’s OAuth client. This prepares your Cloud Code project and may activate the available free tier. A recognized Antigravity installation is required. Repeat for each account, then save the model. Generation must be tested separately.'
                : 'Enter a Desktop OAuth client from your Google Cloud project. Your project and account must have access to the configured Cloud Code service. Repeat Sign in with Google for each account, then save the model.';
        };
        loginMode.addEventListener('change', updateLoginMode);
        updateLoginMode();
        const loginActions = element('div', 'agy-actions');
        loginActions.append(button('Sign in with Google', async () => {
            const authMode = loginMode.value === 'custom' ? 'custom' : 'antigravity';
            if (authMode === 'custom' && !loginClient.value.trim())
                throw new Error('Enter your Desktop OAuth client ID.');
            if (accountOperationPending)
                throw new Error('Wait for the current Google account operation or cancel it.');
            accountOperationPending = true;
            const attempt = ++accountOperationAttempt;
            const cancel = () => {
                accountOperationAttempt++;
                void electron_1.ipcRenderer.invoke('storage:google-login-cancel').catch(() => { });
            };
            cancelModalOperation = cancel;
            for (const input of [loginMode, loginLabel, loginClient, loginSecret])
                input.disabled = true;
            setStatus(status, authMode === 'antigravity'
                ? 'Complete consent in your browser, then wait for account preparation. Browser login expires after two minutes.'
                : 'Complete consent in your browser. This login expires after two minutes.');
            try {
                const result = await electron_1.ipcRenderer.invoke('storage:google-login', {
                    authMode,
                    ...(authMode === 'custom'
                        ? { clientId: loginClient.value.trim(), clientSecret: loginSecret.value.trim() || undefined }
                        : {}),
                    label: loginLabel.value.trim() || undefined,
                });
                if (!panel.isConnected || accountOperationAttempt !== attempt)
                    return;
                requireSuccess(result);
                if (!result.account)
                    throw new Error('Google login did not return an account.');
                addAccount(result.account);
                loginSecret.value = '';
                setStatus(status, 'Account authorized. Save the model within 10 minutes to retain it; otherwise sign in again. Use Test account to check service access and quota, then Test generation to verify a model response.');
            }
            finally {
                accountOperationPending = false;
                for (const input of [loginMode, loginLabel, loginClient, loginSecret])
                    input.disabled = false;
                if (cancelModalOperation === cancel)
                    cancelModalOperation = undefined;
            }
        }, status), button('Cancel Google login', async () => {
            accountOperationAttempt++;
            requireSuccess(await electron_1.ipcRenderer.invoke('storage:google-login-cancel'));
            cancelModalOperation = undefined;
            setStatus(status, 'Google login cancelled.');
        }, status));
        login.append(loginActions);
        const importer = element('details');
        importer.append(element('summary', '', 'Import account credentials'));
        importer.append(element('p', 'agy-muted', 'Import your own authorized_user JSON, an account object, or an accounts array. Importing does not open a browser or make network requests.'));
        const accountJson = jsonField(importer, 'Account JSON', 'agy-google-account-json', undefined);
        const file = field(importer, 'Credential JSON file', 'agy-google-account-file', '', 'file');
        file.accept = '.json,application/json';
        file.addEventListener('change', async () => {
            try {
                const selected = file.files?.[0];
                if (!selected)
                    return;
                if (selected.size > 512 * 1024)
                    throw new Error('Account files must be smaller than 512 KB.');
                accountJson.value = await selected.text();
            }
            catch (error) {
                setStatus(status, String(error), true);
            }
        });
        importer.append(button('Import accounts', () => {
            let data;
            try {
                data = JSON.parse(accountJson.value);
            }
            catch {
                throw new Error('Account credentials must be valid JSON.');
            }
            const root = data;
            const values = Array.isArray(data) ? data : root?.accounts || root?.googleAccounts || [data];
            if (!Array.isArray(values) || !values.length || values.length + accounts.length > 50)
                throw new Error('Import between 1 and 50 accounts.');
            const incoming = values.map((value) => {
                if (!value || typeof value !== 'object' || Array.isArray(value))
                    throw new Error('Each account must be a JSON object.');
                const entry = value;
                const text = (key, alternate = key) => String(entry[key] || entry[alternate] || '');
                const account = {
                    id: text('id') || randomId(),
                    label: text('label', 'accountEmail') || 'Imported account',
                    refreshToken: text('refreshToken', 'refresh_token'),
                    accessToken: text('accessToken', 'access_token'),
                    clientId: text('clientId', 'client_id'),
                    clientSecret: text('clientSecret', 'client_secret'),
                    project: text('project', 'quota_project_id'),
                    ...(entry.authMode === 'custom' || entry.authMode === 'antigravity' ? { authMode: entry.authMode } : {}),
                    ...(entry.cloudCodeEndpoint ? { cloudCodeEndpoint: text('cloudCodeEndpoint') } : {}),
                    enabled: entry.enabled !== false,
                    ...(entry.expiresAt != null ? { expiresAt: Number(entry.expiresAt) } : {}),
                };
                if (!account.refreshToken && !account.accessToken)
                    throw new Error('An imported account must contain a refresh token or access token.');
                if (account.refreshToken && !account.clientId)
                    throw new Error('An imported refresh token requires its OAuth client ID.');
                return account;
            });
            for (const account of incoming)
                addAccount(account);
            accountJson.value = '';
            file.value = '';
            setStatus(status, `Imported ${incoming.length} accounts. Save the model to encrypt and retain them.`);
        }, status));
        panel.append(list, actions, editor, login, importer, status);
        parent.append(panel);
        renderAccounts();
        return () => accounts.map((account) => ({ ...account }));
    }
    const nonSettingsContent = '#agy-custom-models-section,#agy-modal-overlay,button,nav,[role="tablist"],article,[role="article"],pre,code,' +
        '[data-testid="conversation-view"],[data-testid="autoscroll-viewport"],[role="log"]';
    function isSettingsContent(node) {
        if (node.closest(nonSettingsContent))
            return false;
        for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
            if (ancestor.hidden || ancestor.getAttribute('aria-hidden') === 'true')
                return false;
            const style = window.getComputedStyle(ancestor);
            if (style.display === 'none' || style.visibility === 'hidden')
                return false;
        }
        return true;
    }
    function findRefreshButton(root) {
        return (Array.from(root.querySelectorAll('button')).find((node) => !node.closest('#agy-custom-models-section') &&
            isSettingsContent(node.parentElement || node) &&
            (node.textContent?.trim() === 'Refresh' ||
                /refresh quota/i.test(`${node.getAttribute('aria-label') || ''} ${node.title || ''}`))) || null);
    }
    async function modelsChanged() {
        const restore = captureScrollPosition(document.getElementById('agy-custom-models-section') || document.body);
        fleetEpoch++;
        quotaCache.clear();
        customModelsCache.ts = 0;
        await renderCustomModelsList();
        const mount = findSettingsMount();
        if (mount)
            findRefreshButton(mount)?.click();
        restore();
    }
    function uniqueName(base) {
        let name = base, index = 2;
        while (modelList.some((model) => model.name === name))
            name = `${base}-${index++}`;
        return name;
    }
    function captureScrollPosition(node) {
        const positions = new Map();
        for (let parent = node; parent; parent = parent.parentElement)
            positions.set(parent, { top: parent.scrollTop, left: parent.scrollLeft });
        const scrollingElement = document.scrollingElement;
        if (scrollingElement && !positions.has(scrollingElement))
            positions.set(scrollingElement, { top: scrollingElement.scrollTop, left: scrollingElement.scrollLeft });
        return () => {
            for (const [element, position] of positions) {
                if (!element.isConnected)
                    continue;
                element.scrollTop = position.top;
                element.scrollLeft = position.left;
            }
        };
    }
    function openDeleteModelModal(model) {
        const { body, status, close } = openModal('Delete model');
        body.append(element('p', '', `Delete “${model.displayName || model.name}”?`), element('p', 'agy-muted', 'This removes the saved model configuration from this app.'));
        const actions = element('div', 'agy-actions');
        actions.append(button('Cancel', close), button('Delete model', async () => {
            const visibleRows = Array.from(document.querySelectorAll('#agy-custom-models-content [data-model-name]'));
            const deletedIndex = visibleRows.findIndex((row) => row.dataset.modelName === model.name);
            const adjacentNames = [...visibleRows.slice(deletedIndex + 1), ...visibleRows.slice(0, deletedIndex).reverse()]
                .map((row) => row.dataset.modelName);
            setStatus(status, 'Deleting model…');
            requireSuccess(await storageAPI.deleteCustomModel(model.name));
            // The user may have closed this dialog while storage was updating.
            const dialogStillOpen = body.isConnected;
            if (dialogStillOpen)
                close();
            const focusAfterClose = document.activeElement;
            await modelsChanged();
            if (dialogStillOpen && !document.getElementById('agy-modal-overlay') &&
                (document.activeElement === document.body || document.activeElement === focusAfterClose)) {
                const remainingRows = Array.from(document.querySelectorAll('#agy-custom-models-content [data-model-name]'));
                const adjacentRow = adjacentNames.map((name) => remainingRows.find((row) => row.dataset.modelName === name)).find(Boolean);
                const nextFocus = Array.from(adjacentRow?.querySelectorAll('button') || [])
                    .find((button) => button.textContent === 'Delete') || document.getElementById('agy-add-model');
                nextFocus?.focus({ preventScroll: true });
            }
        }, status, true));
        body.append(actions);
    }
    const quotaCache = new Map();
    let fleetEpoch = 0;
    let fleetBusy = false;
    let fleetError = '';
    let fleetCollapsed = false;
    let fleetTargetPool = '';
    try {
        fleetCollapsed = localStorage.getItem('agy_google_fleet_collapsed') === 'true';
    }
    catch { }
    let fleetRefreshing = false;
    let fleetTimer;
    function fleetMembers(models) {
        const members = [];
        for (const model of models) {
            if (model.provider !== 'google-cloudcode' || !Array.isArray(model.googleAccounts))
                continue;
            for (const account of model.googleAccounts) {
                if (!account?.id)
                    continue;
                members.push({ account, owner: model });
            }
        }
        return members;
    }
    function fleetAccounts(models) {
        const rows = new Map();
        for (const member of fleetMembers(models)) {
            const { owner, account } = member;
            const email = (account.email || quotaCache.get(quotaKey(owner, account))?.quota?.email)?.trim();
            // Only a known email identifies a shared account. Unknown memberships stay
            // separate, and grouping never replaces the original owner/account used by actions.
            const key = email ? `email:${email.toLowerCase()}` : `member:${owner.name}:${account.id}`;
            const row = rows.get(key);
            if (row)
                row.members.push(member);
            else
                rows.set(key, { identity: email || account.label || account.id, members: [member] });
        }
        return [...rows.values()];
    }
    function quotaKey(model, account) {
        return JSON.stringify([model.name, model.apiUrl, model.externalModelName, account.id, account.email, account.clientId, account.project, account.authMode, account.cloudCodeEndpoint]);
    }
    async function connectFleetAccount(modelName, replaceAccountId) {
        const { body, status, close } = openModal(replaceAccountId ? 'Reconnect Google account' : 'Add Google account');
        body.append(element('p', 'agy-muted', `Complete Google sign-in in your browser. The account is saved to ${modelName}.`));
        cancelModalOperation = () => { void electron_1.ipcRenderer.invoke('storage:google-login-cancel'); };
        setStatus(status, 'Waiting for Google sign-in…');
        try {
            const result = await electron_1.ipcRenderer.invoke('storage:google-login', { authMode: 'antigravity' });
            if (!body.isConnected)
                return;
            requireSuccess(result);
            if (!result.account)
                throw new Error('Google did not return an account.');
            requireSuccess(await electron_1.ipcRenderer.invoke('storage:google-link-account', { modelName, accountId: result.account.id, ...(replaceAccountId ? { replaceAccountId } : {}) }));
            quotaCache.clear();
            cancelModalOperation = undefined;
            close();
            await modelsChanged();
        }
        catch (error) {
            if (body.isConnected)
                setStatus(status, error instanceof Error ? error.message : String(error), true);
        }
    }
    function removeFleetAccount(account, modelName) {
        const { body, status, close } = openModal('Remove Google account');
        body.append(element('p', '', `Remove ${account.email || account.label || account.id} from ${modelName}? This model will be disabled if no enabled account remains. Other model pools and your IDE login are preserved.`));
        body.append(button('Remove account', async () => {
            requireSuccess(await electron_1.ipcRenderer.invoke('storage:google-remove-account', { modelName, accountId: account.id }));
            quotaCache.clear();
            close();
            await modelsChanged();
        }, status), button('Cancel', close));
    }
    async function runFleetAction(action) {
        if (fleetBusy)
            throw new Error('Wait for the current account change to finish.');
        fleetBusy = true;
        fleetError = '';
        renderGoogleFleet();
        const disabledStates = new Map();
        const roots = document.querySelectorAll('#agy-custom-models-section, #agy-modal-overlay');
        for (const root of roots) {
            for (const control of root.querySelectorAll('button,input,select,textarea')) {
                disabledStates.set(control, control.disabled);
                control.disabled = true;
            }
        }
        try {
            await action();
        }
        catch (error) {
            fleetError = error instanceof Error ? error.message : String(error);
            throw error;
        }
        finally {
            // Keep the lock until fresh records replace the old model/group closures.
            // The button helper also guards controls created during an async rerender.
            try {
                await modelsChanged();
            }
            finally {
                fleetBusy = false;
                for (const [control, wasDisabled] of disabledStates) {
                    if (control.isConnected)
                        control.disabled = wasDisabled;
                }
                renderGoogleFleet();
                void refreshFleetQuotas();
            }
        }
    }
    async function updateFleetAccounts(members, update, updateAvailability = false) {
        // Read current records and save each owner once. A card is a display grouping;
        // its members retain their original IDs, credentials, projects and endpoints.
        const current = await storageAPI.getCustomModels();
        for (const owner of current) {
            const selected = new Set(members.filter((m) => m.owner.name === owner.name).map((m) => m.account.id));
            if (!selected.size || !Array.isArray(owner.googleAccounts))
                continue;
            const accounts = owner.googleAccounts;
            const updated = accounts.map((account) => selected.has(account.id) ? update(account) : account);
            const hadEnabled = accounts.some((account) => account.enabled !== false);
            const hasEnabled = updated.some((account) => account.enabled !== false);
            requireSuccess(await storageAPI.saveCustomModel({
                ...owner,
                googleAccounts: updated,
                ...(updateAvailability ? { enabled: hasEnabled ? (hadEnabled ? owner.enabled : true) : false } : {}),
            }));
        }
    }
    function editFleetLabel(identity, members) {
        const { body, status, close } = openModal('Edit account label');
        body.append(element('p', 'agy-muted', `Update the label for ${identity}. Use a model pool's account editor to change its credentials or project.`));
        const label = field(body, 'Account label', 'agy-fleet-account-label', members[0]?.account.label || '');
        body.append(button('Save account label', async () => {
            await runFleetAction(() => updateFleetAccounts(members, (account) => ({ ...account, label: label.value.trim() })));
            close();
        }, status, true), button('Cancel', close));
    }
    function removeFleetMemberships(identity, members) {
        const { body, status, close } = openModal('Remove account from fleet');
        body.append(element('p', '', `Remove ${identity} from ${members.length} assigned model pool${members.length === 1 ? '' : 's'}?`), element('p', 'agy-muted', 'Model definitions and other accounts are preserved. Pools without enabled accounts will be disabled.'));
        body.append(button('Remove from all pools', async () => {
            await runFleetAction(async () => {
                for (const { owner, account } of members) {
                    requireSuccess(await electron_1.ipcRenderer.invoke('storage:google-remove-account', { modelName: owner.name, accountId: account.id }));
                }
            });
            close();
        }, status), button('Cancel', close));
    }
    function relativeQuotaReset(value) {
        const diff = Date.parse(value) - Date.now();
        if (!Number.isFinite(diff))
            return '';
        if (diff <= 0)
            return 'Reset due · refresh quota';
        const minutes = Math.ceil(diff / 60000);
        if (minutes >= 1440)
            return `Resets in ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
        if (minutes >= 60)
            return `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
        return `Resets in ${minutes}m`;
    }
    function renderPoolQuota(quota, cached) {
        if (cached?.quota?.planTier) {
            const tier = cached.quota.planTier;
            quota.append(element('span', `agy-pool-badge${/\bpro\b/i.test(tier) ? ' agy-plan-pro' : ''}`, tier));
        }
        if (cached?.error) {
            quota.append(element('div', 'agy-status agy-error', cached.error));
            return;
        }
        if (!cached) {
            quota.append(element('span', 'agy-muted', 'Loading quota…'));
            return;
        }
        // The flat snapshot contains every parsed bucket, including groups. Never
        // deduplicate across projects, model pools, or distinct model buckets.
        const buckets = cached.quota?.buckets || [];
        if (!buckets.length) {
            quota.append(element('span', 'agy-muted', 'Quota unavailable — Google returned no buckets.'));
            return;
        }
        const groups = new Map();
        for (const bucket of buckets) {
            const title = bucket.groupName || 'Reported quota';
            groups.set(title, [...(groups.get(title) || []), bucket]);
        }
        for (const [title, buckets] of groups) {
            const group = element('div', 'agy-quota-group');
            group.append(element('div', 'agy-quota-group-title', title));
            for (const bucket of buckets) {
                const block = element('div', 'agy-quota-bucket');
                const fraction = bucket.remainingFraction;
                const known = typeof fraction === 'number' && Number.isFinite(fraction);
                block.dataset.exhausted = String(known && fraction <= 0);
                const title = bucket.displayName || { weekly: 'Weekly limit', five_hour: 'Five-hour limit', daily: 'Daily limit' }[bucket.id] || bucket.id;
                const heading = element('div', 'agy-quota-heading');
                heading.append(element('span', 'agy-muted', title), element('span', 'agy-quota-value', known ? `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}% remaining` : 'Remaining quota unknown'));
                block.append(heading);
                if (known) {
                    const progress = element('progress');
                    progress.max = 1;
                    progress.value = Math.max(0, Math.min(1, fraction));
                    progress.setAttribute('aria-label', `${bucket.groupName || ''} ${title} remaining quota`.trim());
                    block.append(progress);
                }
                if (bucket.resetTime) {
                    const text = relativeQuotaReset(bucket.resetTime);
                    if (text) {
                        const reset = element('div', 'agy-quota-reset', text);
                        reset.title = new Date(bucket.resetTime).toLocaleString();
                        block.append(reset);
                    }
                }
                group.append(block);
            }
            quota.append(group);
        }
    }
    async function refreshFleetQuotas(force = false) {
        if (fleetRefreshing || fleetBusy)
            return;
        const container = document.getElementById('agy-google-account-pool-section');
        if (!container?.isConnected || container.hidden)
            return;
        const members = fleetMembers(modelList).filter(({ owner, account }) => force || Date.now() - (quotaCache.get(quotaKey(owner, account))?.at || 0) >= 120000);
        if (!members.length)
            return;
        const epoch = fleetEpoch;
        fleetRefreshing = true;
        renderGoogleFleet();
        try {
            // A small sequential queue avoids a login or quota request burst on large fleets.
            for (const { account, owner } of members) {
                if (!container.isConnected || fleetEpoch !== epoch || fleetBusy)
                    break;
                const key = quotaKey(owner, account);
                if (!force && Date.now() - (quotaCache.get(key)?.at || 0) < 120000)
                    continue;
                try {
                    const result = await electron_1.ipcRenderer.invoke('storage:google-test-account', { modelName: owner.name, accountId: account.id });
                    requireSuccess(result);
                    if (fleetEpoch === epoch)
                        quotaCache.set(key, { quota: result.quota, at: Date.now() });
                }
                catch (error) {
                    if (fleetEpoch === epoch)
                        quotaCache.set(key, { error: error instanceof Error ? error.message : String(error), at: Date.now() });
                }
            }
        }
        finally {
            fleetRefreshing = false;
            if (container.isConnected)
                renderGoogleFleet();
            if (fleetEpoch !== epoch)
                void refreshFleetQuotas();
        }
    }
    function renderGoogleFleet() {
        const container = document.getElementById('agy-google-account-pool-section');
        if (!container)
            return;
        const restoreScroll = captureScrollPosition(container);
        const rows = fleetAccounts(modelList);
        const hasGoogleModels = modelList.some((model) => model.provider === 'google-cloudcode');
        container.hidden = !hasGoogleModels;
        if (!hasGoogleModels) {
            container.replaceChildren();
            restoreScroll();
            return;
        }
        const keys = new Set(fleetMembers(modelList).map(({ account, owner }) => quotaKey(owner, account)));
        for (const key of quotaCache.keys())
            if (!keys.has(key))
                quotaCache.delete(key);
        const header = element('div', 'agy-toolbar');
        const collapse = button(`${fleetCollapsed ? '▸' : '▾'} Google account fleet · ${rows.length} account${rows.length === 1 ? '' : 's'}`, () => {
            fleetCollapsed = !fleetCollapsed;
            try {
                localStorage.setItem('agy_google_fleet_collapsed', String(fleetCollapsed));
            }
            catch { }
            renderGoogleFleet();
            document.getElementById('agy-fleet-collapse')?.focus({ preventScroll: true });
        });
        collapse.id = 'agy-fleet-collapse';
        collapse.setAttribute('aria-expanded', String(!fleetCollapsed));
        collapse.setAttribute('aria-controls', 'agy-fleet-details');
        header.append(collapse);
        const actions = element('div', 'agy-actions');
        const targetPool = element('select');
        targetPool.id = 'agy-fleet-target-pool';
        targetPool.setAttribute('aria-label', 'Pool for new Google account');
        for (const model of modelList.filter((model) => model.provider === 'google-cloudcode')) {
            const option = element('option', '', model.displayName || model.name);
            option.value = model.name;
            targetPool.append(option);
        }
        if (Array.from(targetPool.options).some((option) => option.value === fleetTargetPool))
            targetPool.value = fleetTargetPool;
        targetPool.onchange = () => { fleetTargetPool = targetPool.value; };
        actions.append(targetPool);
        const add = button('+ Add Account', () => connectFleetAccount(targetPool.value));
        add.id = 'agy-pool-add-account-btn';
        const refresh = button(fleetRefreshing ? 'Refreshing quotas…' : 'Refresh quotas', () => refreshFleetQuotas(true));
        refresh.id = 'agy-fleet-refresh';
        refresh.disabled = fleetRefreshing;
        actions.append(add, refresh);
        header.append(actions);
        const wrap = element('div', 'agy-fleet-details');
        wrap.id = 'agy-fleet-details';
        wrap.hidden = fleetCollapsed;
        const fallback = element('label', 'agy-fleet-fallback');
        const fallbackInput = element('input');
        fallbackInput.type = 'checkbox';
        fallbackInput.id = 'agy-fleet-native-failover';
        const googleModels = modelList.filter((model) => model.provider === 'google-cloudcode');
        const enabledFallbacks = googleModels.filter((model) => model.googlePool?.nativeFailoverEnabled === true).length;
        fallbackInput.checked = enabledFallbacks > 0;
        fallbackInput.indeterminate = enabledFallbacks > 0 && enabledFallbacks < googleModels.length;
        fallback.append(fallbackInput, element('span', '', 'Native Google request fallback'), element('span', 'agy-muted', fallbackInput.indeterminate ? 'Some pools enabled' : fallbackInput.checked ? 'Enabled' : 'Disabled'));
        fallbackInput.addEventListener('change', async () => {
            const enabled = fallbackInput.checked;
            try {
                await runFleetAction(async () => {
                    for (const model of await storageAPI.getCustomModels()) {
                        if (model.provider !== 'google-cloudcode')
                            continue;
                        requireSuccess(await storageAPI.saveCustomModel({
                            ...model, googlePool: { ...(model.googlePool || {}), nativeFailoverEnabled: enabled },
                        }));
                    }
                });
            }
            catch { /* runFleetAction displays the persisted result and error. */ }
        });
        wrap.append(fallback, element('p', 'agy-muted', 'Each model pool keeps its own credentials, project and reported quotas. Preferred accounts are used when eligible; unknown limits are not available credit.'));
        const table = element('table', 'agy-fleet-table');
        table.setAttribute('aria-label', 'Google account fleet');
        const tbody = element('tbody');
        for (const { identity: accountIdentity, members } of rows) {
            const row = element('tr');
            row.dataset.accountIdentity = accountIdentity;
            const cell = element('td');
            const card = element('article', 'agy-fleet-card');
            const cardHeader = element('div', 'agy-fleet-card-header');
            const identity = element('div');
            identity.append(element('div', 'agy-fleet-label', accountIdentity), element('div', 'agy-muted', `${members.length} model pool${members.length === 1 ? '' : 's'}`));
            const labels = [...new Set(members.map(({ account }) => account.label?.trim()).filter((label) => !!label && label !== accountIdentity))];
            if (labels.length)
                identity.append(element('div', 'agy-muted', labels.join(' · ')));
            const activeCount = members.filter(({ account }) => account.enabled !== false).length;
            identity.append(element('span', `agy-fleet-account-state agy-pool-badge${activeCount === 0 ? ' agy-pool-disabled' : ''}`, activeCount === 0 ? 'Disabled' : activeCount === members.length ? 'Enabled' : 'Partially enabled'));
            const accountActions = element('div', 'agy-actions agy-fleet-account-actions');
            accountActions.append(button(activeCount ? 'Disable account' : 'Enable account', async () => {
                await runFleetAction(() => updateFleetAccounts(members, (account) => ({ ...account, enabled: activeCount === 0 }), true));
            }), button('Edit label', () => editFleetLabel(accountIdentity, members)), button('Remove from fleet', () => removeFleetMemberships(accountIdentity, members)));
            cardHeader.append(identity, accountActions);
            card.append(cardHeader);
            const pools = element('div', 'agy-fleet-pools');
            for (const { account, owner } of members) {
                const cached = quotaCache.get(quotaKey(owner, account));
                const pool = element('section', 'agy-fleet-pool');
                pool.setAttribute('role', 'group');
                pool.setAttribute('aria-label', `${owner.displayName || owner.name} account ${account.id}`);
                pool.dataset.modelName = owner.name;
                pool.dataset.accountId = account.id;
                const poolHeading = element('div', 'agy-group-heading');
                const poolIdentity = element('div');
                poolIdentity.append(element('h3', '', owner.displayName || owner.name), element('div', 'agy-muted', [owner.name, `Account: ${account.id}`, account.project ? `Project: ${account.project}` : ''].filter(Boolean).join(' · ')));
                const preferred = owner.googlePool?.preferredAccountId === account.id;
                const enabled = owner.enabled !== false && account.enabled !== false;
                poolHeading.append(poolIdentity, element('span', `agy-pool-badge${preferred ? ' agy-pool-preferred' : ''}`, !enabled ? 'Disabled' : preferred ? 'Preferred' : 'Automatic'));
                pool.append(poolHeading);
                const quota = element('div', 'agy-fleet-quotas');
                renderPoolQuota(quota, cached);
                const rowActions = element('div', 'agy-actions');
                const choose = button(preferred ? 'Automatic' : 'Use preferred', async () => {
                    await runFleetAction(async () => {
                        requireSuccess(await electron_1.ipcRenderer.invoke('storage:google-select-account', { modelName: owner.name, ...(preferred ? {} : { accountId: account.id }) }));
                    });
                });
                choose.disabled = !enabled;
                rowActions.append(choose, account.authMode === 'antigravity' ? button('Reconnect', () => connectFleetAccount(owner.name, account.id)) : button('Edit account', () => openModelModal(owner)), button('Remove', () => removeFleetAccount(account, owner.name)));
                pool.append(quota, rowActions);
                pools.append(pool);
            }
            card.append(pools);
            cell.append(card);
            row.append(cell);
            tbody.append(row);
        }
        table.append(tbody);
        wrap.append(table);
        const status = statusNode();
        setStatus(status, fleetError || (fleetRefreshing ? 'Checking each model pool’s quota…' : ''), !!fleetError);
        container.setAttribute('aria-busy', String(fleetBusy || fleetRefreshing));
        container.replaceChildren(header, status, wrap);
        if (fleetBusy) {
            for (const control of container.querySelectorAll('button,input,select')) {
                if (control !== collapse)
                    control.disabled = true;
            }
        }
        restoreScroll();
    }
    async function renderCustomModelsList() {
        const target = document.getElementById('agy-custom-models-content');
        if (!target)
            return;
        const version = ++renderVersion;
        try {
            const models = await storageAPI.getCustomModels();
            if (version !== renderVersion || !target.isConnected)
                return;
            const restoreScroll = captureScrollPosition(target);
            modelList = models;
            renderGoogleFleet();
            void refreshFleetQuotas();
            const content = document.createDocumentFragment();
            const groups = new Map();
            for (const model of models) {
                if (searchTerm &&
                    !`${model.displayName} ${model.name} ${model.externalModelName} ${model.provider}`
                        .toLowerCase()
                        .includes(searchTerm))
                    continue;
                const key = `${model.provider}\n${model.apiUrl}`;
                groups.set(key, [...(groups.get(key) || []), model]);
            }
            if (!groups.size)
                content.append(element('p', 'agy-muted', models.length
                    ? 'No models match this search.'
                    : 'Add a provider model, discover a local server, or import a configuration to get started.'));
            for (const models of groups.values()) {
                const first = models[0];
                const group = element('section', 'agy-group');
                const header = element('div', 'agy-group-heading');
                const heading = element('div');
                heading.append(element('h3', '', `${first.provider} · ${models.filter((model) => model.enabled !== false).length}/${models.length} enabled`), element('div', 'agy-muted', first.apiUrl));
                const groupStatus = statusNode();
                const actions = element('div', 'agy-actions');
                actions.append(button('Discover models', () => openModelModal(first, 'discover'), groupStatus));
                const allEnabled = models.every((model) => model.enabled !== false);
                actions.append(button(allEnabled ? 'Disable group' : 'Enable group', async () => {
                    for (const model of models)
                        requireSuccess(await storageAPI.saveCustomModel({ ...model, enabled: !allEnabled }));
                    await modelsChanged();
                }, groupStatus));
                header.append(heading, actions);
                group.append(header, groupStatus);
                for (const model of models) {
                    const row = element('div', 'agy-row');
                    row.dataset.modelName = model.name;
                    row.dataset.enabled = String(model.enabled !== false);
                    const info = element('div', 'agy-row-info');
                    info.append(element('strong', '', model.displayName || model.name), element('div', 'agy-muted', model.externalModelName));
                    if (model.nativePickerAvailable === false)
                        info.append(element('div', 'agy-muted', typeof model.nativePickerError === 'string' ? model.nativePickerError :
                            'Not currently available in the native model picker. Direct API access remains available.'));
                    const rowStatus = statusNode();
                    info.append(rowStatus);
                    const actions = element('div', 'agy-actions');
                    actions.append(button(model.enabled === false ? 'Enable' : 'Disable', async () => {
                        requireSuccess(await storageAPI.saveCustomModel({ ...model, enabled: model.enabled === false }));
                        await modelsChanged();
                    }, rowStatus), button('Test', async () => {
                        setStatus(rowStatus, 'Testing…');
                        const result = requireSuccess(await storageAPI.testModelConnection(model));
                        setStatus(rowStatus, result.message || 'Connection successful.');
                    }, rowStatus), button('Test generation', () => openGenerationTest(model), rowStatus), button('Edit', () => openModelModal(model, 'edit'), rowStatus), button('Duplicate', () => openModelModal(model, 'duplicate'), rowStatus), ...(model.supportsThinking === false
                        ? []
                        : [
                            button('Effort variants', () => {
                                const { body, status, close } = openModal('Create reasoning variants');
                                body.append(element('p', 'agy-muted', 'Creates three copies with low, medium and high reasoning effort. The provider must support reasoning. For Google and Anthropic formats the thinking budgets are 1,024 / 4,096 / 8,192 tokens; output limits increase if needed to fit the budget. Existing models and credentials are preserved.'));
                                body.append(button('Create three variants', async () => {
                                    requireSuccess(await electron_1.ipcRenderer.invoke('storage:create-effort-variants', model.name));
                                    close();
                                    await modelsChanged();
                                }, status, true));
                            }, rowStatus),
                        ]), button('Delete', () => openDeleteModelModal(model), rowStatus));
                    row.append(info, actions);
                    group.append(row);
                }
                content.append(group);
            }
            target.replaceChildren(content);
            restoreScroll();
        }
        catch (error) {
            setStatus(target, error instanceof Error ? error.message : 'Could not load custom models.', true);
        }
    }
    async function openModelModal(existing, mode = 'edit') {
        const { body, status, close } = openModal(mode === 'duplicate'
            ? 'Duplicate model'
            : mode === 'discover'
                ? 'Discover provider models'
                : existing
                    ? 'Edit model'
                    : 'Add custom model');
        try {
            const presets = await storageAPI.getPresets();
            if (!body.isConnected)
                return;
            const providers = [...presets];
            if (existing && !providers.some((preset) => preset.id === existing.provider))
                providers.push({
                    id: existing.provider,
                    label: existing.provider,
                    defaultUrl: existing.apiUrl,
                    apiFormat: existing.apiFormat || 'openai',
                    keyRequired: false,
                });
            if (!providers.length)
                throw new Error('Provider presets are unavailable. Close this dialog and try again.');
            const provider = selectField(body, 'Provider', 'agy-provider', providers.map((preset) => [preset.id, preset.label]), existing?.provider || providers[0].id);
            const preset = () => providers.find((value) => value.id === provider.value) || providers[0];
            const apiUrl = field(body, 'API URL', 'agy-api-url', existing?.apiUrl || preset().defaultUrl, 'url');
            const workersHint = element('p', 'agy-muted', 'Cloudflare: replace ACCOUNT_ID in the API URL with your 32-character Account ID. Use the Workers AI API token template, or keep your existing authentication headers. Model discovery verifies catalog access; generation is not tested.');
            body.append(workersHint);
            function workersConnection() {
                if (provider.value === 'workers-ai')
                    return true;
                try {
                    const url = new URL(apiUrl.value);
                    return url.origin === 'https://api.cloudflare.com' && /^\/client\/v4\/accounts\//.test(url.pathname);
                }
                catch {
                    return false;
                }
            }
            const updateWorkersHint = () => {
                workersHint.hidden = !workersConnection();
            };
            apiUrl.addEventListener('input', updateWorkersHint);
            updateWorkersHint();
            const apiKey = field(body, 'API key', 'agy-api-key', existing?.apiKey === 'none' ? '' : existing?.apiKey || '', 'password');
            apiKey.placeholder = preset().keyRequired ? 'Enter provider API key' : 'Optional for local servers';
            const opencodeAuth = selectField(body, 'OpenCode authentication', 'agy-opencode-auth', [['auth', 'API key'], ['noAuth', 'Keyless request']], existing?.apiKey && existing.apiKey !== 'none' ? 'auth' : 'noAuth');
            const opencodeHint = element('p', 'agy-muted', 'OpenCode may restrict keyless free models to its own app. If the service rejects this client, add an API key or choose another model/provider.');
            body.append(opencodeHint);
            const isOpencode = () => ['opencode', 'zen'].includes(provider.value) || (() => {
                try {
                    const url = new URL(apiUrl.value);
                    return url.origin === 'https://opencode.ai' && !/\/(?:zen|inference)\/go\//.test(url.pathname);
                }
                catch {
                    return false;
                }
            })();
            const keylessOpencode = () => isOpencode() && opencodeAuth.value === 'noAuth';
            const updateOpencodeAuth = () => {
                opencodeAuth.closest('label').hidden = !isOpencode();
                opencodeHint.hidden = !isOpencode();
                apiKey.closest('label').hidden = provider.value === 'google-cloudcode' || keylessOpencode();
            };
            opencodeAuth.addEventListener('change', updateOpencodeAuth);
            apiUrl.addEventListener('input', updateOpencodeAuth);
            updateOpencodeAuth();
            const apiFormat = selectField(body, 'API format', 'agy-api-format', [
                ['openai', 'OpenAI compatible'],
                ['anthropic', 'Anthropic Messages'],
                ['google', 'Google Gemini'],
            ], existing?.apiFormat || preset().apiFormat);
            const grid = element('div', 'agy-grid');
            const modelId = field(grid, 'Provider model ID', 'agy-model-id', mode === 'discover' ? '' : existing?.externalModelName || '');
            const displayName = field(grid, 'Display name', 'agy-display-name', mode === 'duplicate'
                ? `${existing?.displayName || existing?.externalModelName || ''} copy`
                : mode === 'discover'
                    ? ''
                    : existing?.displayName || '');
            body.append(grid);
            const name = field(body, 'Configuration name (unique)', 'agy-model-name', mode === 'duplicate' ? uniqueName(`${existing?.name}-copy`) : mode === 'discover' ? '' : existing?.name || '');
            name.placeholder = 'Generated from provider and model ID when left blank';
            const description = field(body, 'Description', 'agy-description', String(existing?.description || ''));
            const googleConfig = element('div');
            googleConfig.id = 'agy-google-account-config';
            const googleProject = field(googleConfig, 'Default Cloud Code project (optional)', 'agy-google-project', String(existing?.googleProject || ''));
            const initialPool = existing?.googlePool;
            const poolGrid = element('div', 'agy-grid');
            const poolStrategy = selectField(poolGrid, 'Account selection', 'agy-google-pool-strategy', [
                ['round-robin', 'Round robin'],
                ['least-loaded', 'Least loaded'],
                ['quota', 'Remaining quota'],
                ['adaptive', 'Adaptive health and load'],
            ], initialPool?.strategy || 'least-loaded');
            const poolConcurrency = field(poolGrid, 'Maximum requests per account', 'agy-google-pool-concurrency', String(initialPool?.maxConcurrency || 2), 'number');
            const poolCooldown = field(poolGrid, 'Account cooldown (milliseconds)', 'agy-google-pool-cooldown', String(initialPool?.cooldownMs || 60000), 'number');
            const nativeFailover = selectField(poolGrid, 'Native Google request fallback', 'agy-google-native-failover', [['false', 'Off'], ['true', 'Use this pool for matching native models']], String(initialPool?.nativeFailoverEnabled === true));
            googleConfig.append(poolGrid);
            googleConfig.append(element('p', 'agy-muted', 'Optional fallback uses this saved Google account pool only when a native request for the exact provider model fails. It does not change your signed-in IDE account.'));
            const readAccounts = createGoogleAccountPanel(googleConfig, Array.isArray(existing?.googleAccounts) ? existing.googleAccounts : [], existing?.name);
            const updateGoogleVisibility = () => {
                const isGoogle = provider.value === 'google-cloudcode';
                googleConfig.hidden = !isGoogle;
                updateOpencodeAuth();
                apiFormat.closest('label').hidden = isGoogle;
            };
            updateGoogleVisibility();
            body.append(googleConfig);
            const advanced = element('details');
            advanced.append(element('summary', '', 'Advanced settings'));
            const advancedGrid = element('div', 'agy-grid');
            const effort = selectField(advancedGrid, 'Reasoning effort', 'agy-reasoning-effort', ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((value) => [
                value,
                value || 'Provider default',
            ]), String(existing?.reasoningEffort || ''));
            const thinking = field(advancedGrid, 'Thinking budget (tokens)', 'agy-thinking-budget', existing?.thinkingBudget != null ? String(existing.thinkingBudget) : '', 'number');
            const compactionEffort = selectField(advancedGrid, 'Compaction reasoning effort', 'agy-compaction-effort', ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((value) => [
                value,
                value || 'Use normal model settings',
            ]), String(existing?.compactionReasoningEffort || ''));
            advancedGrid.append(element('p', 'agy-muted', 'Only recognized IDE continuation summaries use this effort. Choose low for faster summaries, or none if your model supports disabling reasoning. Normal chat keeps its settings.'));
            const maxOutput = field(advancedGrid, 'Maximum output tokens', 'agy-max-output', existing?.maxOutputTokens != null ? String(existing.maxOutputTokens) : '', 'number');
            const context = field(advancedGrid, 'Context window (tokens)', 'agy-context-window', existing?.contextWindow != null ? String(existing.contextWindow) : '', 'number');
            const compactionThreshold = field(advancedGrid, 'IDE compaction threshold (%)', 'agy-compaction-threshold', existing?.compactionThresholdPercent != null ? String(existing.compactionThresholdPercent) : '', 'number');
            compactionThreshold.min = '10';
            compactionThreshold.max = '90';
            compactionThreshold.placeholder = 'IDE default';
            advancedGrid.append(element('p', 'agy-muted', 'Optional, 10–90% of the actual context window in new tokens since the previous checkpoint. Native counts may differ from provider totals. With many tools, start at 50%; higher values can trim older history before a full checkpoint. Leave blank for IDE defaults. The threshold is capped to reserve the model output limit plus 1,024 tokens. Set accurate context and output limits, then fully quit and reopen the IDE; the model cache may take an additional turn to refresh.'));
            advancedGrid.append(element('p', 'agy-muted', 'IDE 2.5.5 needs at least 50,000 input tokens after those reserves. Its native picker may show a compatibility context, for example 90,000 for a real 85,000-token model. Your saved context and provider limit remain 85,000 in that example, and the custom checkpoint policy uses that real limit.'));
            const timeout = field(advancedGrid, 'Request timeout (milliseconds)', 'agy-timeout', existing?.timeout != null ? String(existing.timeout) : '', 'number');
            const retries = field(advancedGrid, 'Maximum retries (0–5)', 'agy-max-retries', existing?.maxRetries != null ? String(existing.maxRetries) : '', 'number');
            retries.max = '5';
            const vision = selectField(advancedGrid, 'Image input', 'agy-vision', [
                ['', 'Auto detect'],
                ['true', 'Supported'],
                ['false', 'Unsupported'],
            ], existing?.supportsVision == null ? '' : String(existing.supportsVision));
            const rawUrl = selectField(advancedGrid, 'Endpoint path', 'agy-raw-url', [
                ['false', 'Normalize for provider'],
                ['true', 'Use exactly as entered'],
            ], String(existing?.rawUrl === true));
            const tls = selectField(advancedGrid, 'TLS certificates', 'agy-tls', [
                ['false', 'Verify certificates'],
                ['true', 'Allow self-signed certificates'],
            ], String(existing?.allowUnauthorized === true));
            const enabled = selectField(advancedGrid, 'Model state', 'agy-enabled', [
                ['true', 'Enabled'],
                ['false', 'Disabled'],
            ], String(existing?.enabled !== false));
            advanced.append(advancedGrid);
            const fallbacks = field(advanced, 'Fallback model configuration names (comma separated)', 'agy-fallback-models', Array.isArray(existing?.fallbackModels) ? existing.fallbackModels.join(', ') : '');
            const headers = jsonField(advanced, 'Custom headers (JSON)', 'agy-custom-headers', existing?.customHeaders);
            const extraBody = jsonField(advanced, 'Additional request fields (JSON)', 'agy-extra-body', existing?.extraBody);
            const systemPrompt = textAreaField(advanced, 'System prompt (added after Antigravity’s own instructions)', 'agy-system-prompt', existing?.systemPrompt, 'For example: Always answer in Turkish.');
            const breaker = existing?.circuitBreaker;
            const breakerGrid = element('div', 'agy-grid');
            const breakerEnabled = selectField(breakerGrid, 'Circuit breaker', 'agy-breaker-enabled', [
                ['', 'Default'],
                ['true', 'Enabled'],
                ['false', 'Disabled'],
            ], breaker?.enabled == null ? '' : String(breaker.enabled));
            const breakerThreshold = field(breakerGrid, 'Failures before cooldown', 'agy-breaker-threshold', breaker?.failureThreshold != null ? String(breaker.failureThreshold) : '', 'number');
            const breakerCooldown = field(breakerGrid, 'Cooldown (milliseconds)', 'agy-breaker-cooldown', breaker?.cooldownMs != null ? String(breaker.cooldownMs) : '', 'number');
            advanced.append(breakerGrid);
            body.append(advanced);
            const discovery = element('div', 'agy-discovery');
            const discoveryFilter = element('div');
            discoveryFilter.hidden = true;
            const discoverySearch = field(discoveryFilter, 'Search provider models', 'agy-discovery-search', '', 'search');
            discoverySearch.placeholder = 'Filter by model name or ID';
            discoverySearch.addEventListener('input', () => showChoices());
            let choices = [];
            const selected = new Set();
            function hasWorkersAuthentication(customHeaders) {
                const authentication = Object.fromEntries(Object.entries(customHeaders || {}).map(([key, value]) => [
                    key.toLowerCase(),
                    typeof value === 'string' ? value.trim() : '',
                ]));
                return !!((apiKey.value.trim() && apiKey.value.trim() !== 'none') ||
                    authentication.authorization ||
                    (authentication['x-auth-key'] && authentication['x-auth-email']));
            }
            function connection() {
                const endpoint = validUrl(apiUrl.value);
                const customHeaders = readJson(headers, 'Custom headers');
                if (workersConnection()) {
                    if (!/^\/client\/v4\/accounts\/[a-f0-9]{32}\/ai\/v1(?:\/chat\/completions)?\/?$/i.test(new URL(endpoint).pathname))
                        throw new Error('Replace ACCOUNT_ID in the Cloudflare API URL with your 32-character Account ID.');
                    if (apiFormat.value !== 'openai')
                        throw new Error('Cloudflare Workers AI requires the OpenAI compatible API format.');
                    if (!hasWorkersAuthentication(customHeaders))
                        throw new Error('Enter a Cloudflare Workers AI API token or authentication headers.');
                }
                return {
                    provider: provider.value,
                    apiUrl: endpoint,
                    apiKey: keylessOpencode() ? 'none' : apiKey.value.trim() || 'none',
                    apiFormat: apiFormat.value,
                    name: existing?.name,
                    allowUnauthorized: tls.value === 'true',
                    externalModelName: modelId.value.trim(),
                    customHeaders,
                    rawUrl: rawUrl.value === 'true',
                    ...(provider.value === 'google-cloudcode'
                        ? {
                            googleAccounts: readAccounts(),
                            googleProject: googleProject.value.trim(),
                            googlePool: {
                                ...initialPool,
                                preferredAccountId: readAccounts().some((account) => account.id === initialPool?.preferredAccountId) ? initialPool?.preferredAccountId : undefined,
                                strategy: poolStrategy.value,
                                nativeFailoverEnabled: nativeFailover.value === 'true',
                                maxConcurrency: readNumber(poolConcurrency, 'Account concurrency', 1),
                                cooldownMs: readNumber(poolCooldown, 'Account cooldown', 1),
                            },
                        }
                        : {}),
                };
            }
            function modelConfig(id, title, localName) {
                if (!id.trim() || /\s/.test(id.trim()))
                    throw new Error('Enter a model ID without spaces.');
                if (preset().keyRequired && !keylessOpencode() && !apiKey.value.trim() && !workersConnection())
                    throw new Error('Enter an API key for this provider.');
                if (provider.value === 'google-cloudcode' && !readAccounts().some((account) => account.enabled !== false))
                    throw new Error('Add and enable at least one Google account.');
                const maxRetries = readNumber(retries, 'Maximum retries');
                if (maxRetries != null && maxRetries > 5)
                    throw new Error('Maximum retries cannot exceed 5.');
                const compactionThresholdPercent = readNumber(compactionThreshold, 'IDE compaction threshold', 10);
                if (compactionThresholdPercent != null && compactionThresholdPercent > 90)
                    throw new Error('IDE compaction threshold cannot exceed 90%.');
                if (compactionThresholdPercent != null && !context.value.trim())
                    throw new Error('Set the actual context window before configuring the IDE compaction threshold.');
                const customHeaders = readJson(headers, 'Custom headers');
                if (customHeaders && Object.values(customHeaders).some((value) => typeof value !== 'string'))
                    throw new Error('Custom header values must be strings.');
                return {
                    ...(mode === 'edit' && existing ? existing : {}),
                    ...connection(),
                    name: localName || name.value.trim() || uniqueName(`models/${provider.value}/${id}`),
                    provider: provider.value,
                    apiUrl: apiUrl.value.trim(),
                    apiKey: keylessOpencode() ? 'none' : apiKey.value.trim() || 'none',
                    externalModelName: id.trim(),
                    displayName: title || id.trim(),
                    description: description.value.trim(),
                    enabled: enabled.value === 'true',
                    apiFormat: apiFormat.value,
                    googleAccounts: provider.value === 'google-cloudcode' ? readAccounts() : undefined,
                    googleProject: provider.value === 'google-cloudcode' ? googleProject.value.trim() || undefined : undefined,
                    googlePool: provider.value === 'google-cloudcode'
                        ? {
                            ...initialPool,
                            preferredAccountId: readAccounts().some((account) => account.id === initialPool?.preferredAccountId) ? initialPool?.preferredAccountId : undefined,
                            strategy: poolStrategy.value,
                            nativeFailoverEnabled: nativeFailover.value === 'true',
                            maxConcurrency: readNumber(poolConcurrency, 'Account concurrency', 1),
                            cooldownMs: readNumber(poolCooldown, 'Account cooldown', 1),
                        }
                        : undefined,
                    reasoningEffort: effort.value || undefined,
                    compactionReasoningEffort: compactionEffort.value || undefined,
                    compactionThresholdPercent,
                    thinkingBudget: readNumber(thinking, 'Thinking budget'),
                    maxOutputTokens: readNumber(maxOutput, 'Maximum output tokens', 1),
                    contextWindow: readNumber(context, 'Context window', 1),
                    timeout: readNumber(timeout, 'Timeout', 1),
                    maxRetries,
                    fallbackModels: fallbacks.value
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean),
                    customHeaders,
                    extraBody: readJson(extraBody, 'Additional request fields'),
                    systemPrompt: systemPrompt.value.trim() || undefined,
                    supportsVision: vision.value === '' ? undefined : vision.value === 'true',
                    rawUrl: rawUrl.value === 'true',
                    allowUnauthorized: tls.value === 'true',
                    circuitBreaker: breakerEnabled.value || breakerThreshold.value || breakerCooldown.value
                        ? {
                            enabled: breakerEnabled.value !== 'false',
                            failureThreshold: readNumber(breakerThreshold, 'Failure threshold', 1),
                            cooldownMs: readNumber(breakerCooldown, 'Cooldown', 1),
                        }
                        : undefined,
                    ...(existing?.name && mode === 'edit'
                        ? { originalName: existing.name }
                        : existing?.name
                            ? { copyFrom: existing.name }
                            : {}),
                };
            }
            function showChoices() {
                discovery.replaceChildren();
                discoveryFilter.hidden = !choices.length;
                if (!choices.length)
                    return;
                const query = discoverySearch.value.trim().toLowerCase();
                const visible = choices.filter((model) => `${model.displayName || ''} ${model.id}`.toLowerCase().includes(query));
                const toolbar = element('div', 'agy-actions');
                const count = element('span', 'agy-muted', `${visible.length} of ${choices.length} models · ${selected.size} selected`);
                toolbar.append(count, button(query ? 'Select filtered' : 'Select all', () => {
                    for (const model of visible)
                        selected.add(model.id);
                    showChoices();
                }, status), button('Clear selection', () => {
                    selected.clear();
                    showChoices();
                }, status));
                discovery.append(toolbar);
                if (!visible.length)
                    discovery.append(element('p', 'agy-muted', 'No provider models match this search.'));
                for (const model of visible) {
                    const label = element('label', 'agy-choice');
                    const checkbox = element('input');
                    checkbox.type = 'checkbox';
                    checkbox.checked = selected.has(model.id);
                    checkbox.addEventListener('change', () => {
                        if (checkbox.checked)
                            selected.add(model.id);
                        else
                            selected.delete(model.id);
                        count.textContent = `${visible.length} of ${choices.length} models · ${selected.size} selected`;
                    });
                    label.append(checkbox, element('span', '', model.displayName && model.displayName !== model.id ? `${model.displayName} · ${model.id}` : model.id));
                    discovery.append(label);
                }
            }
            const actions = element('div', 'agy-actions');
            actions.append(button('Test connection', async () => {
                setStatus(status, 'Testing…');
                const result = requireSuccess(await storageAPI.testModelConnection(connection()));
                setStatus(status, result.message || 'Connection successful.');
            }, status), button('Test generation (may incur charges)', async () => {
                setStatus(status, 'Sending a short generation test…');
                const result = requireSuccess(await storageAPI.testModelGeneration(connection()));
                setStatus(status, result.message || 'Generation succeeded.');
            }, status), button('Fetch provider models', async () => {
                setStatus(status, 'Fetching models…');
                const result = await storageAPI.discoverModels(connection());
                requireSuccess(result);
                choices = result.models || [];
                discoverySearch.value = '';
                selected.clear();
                showChoices();
                setStatus(status, choices.length
                    ? 'Select models below, then choose Add selected.'
                    : 'This provider returned no models. You can enter a model ID manually.');
            }, status), button('Save model', async () => {
                requireSuccess(await storageAPI.saveCustomModel(modelConfig(modelId.value, displayName.value.trim())));
                await modelsChanged();
                close();
            }, status, true));
            body.append(actions, discoveryFilter, discovery);
            body.append(button('Add selected', async () => {
                if (!selected.size)
                    throw new Error('Select at least one model from the fetched list.');
                let saved = 0;
                for (const choice of choices.filter((model) => selected.has(model.id))) {
                    const prior = modelList.find((model) => model.provider === provider.value &&
                        model.apiUrl === apiUrl.value.trim() &&
                        model.externalModelName === choice.id);
                    const config = modelConfig(choice.id, choice.displayName || choice.id, prior?.name || uniqueName(`models/${provider.value}/${choice.id}`));
                    // Prefer explicit form overrides; otherwise retain the catalog's advertised limits/capabilities.
                    for (const key of ['contextWindow', 'maxOutputTokens', 'supportsVision', 'supportsThinking']) {
                        if (config[key] === undefined && choice[key] !== undefined)
                            config[key] = choice[key];
                    }
                    if (typeof config.contextWindow === 'number' &&
                        typeof config.maxOutputTokens === 'number' &&
                        config.maxOutputTokens >= config.contextWindow &&
                        !maxOutput.value.trim()) {
                        config.maxOutputTokens = config.contextWindow > 1 ? config.contextWindow - 1 : undefined;
                    }
                    delete config.originalName;
                    if (prior)
                        config.originalName = prior.name;
                    else if (existing?.name)
                        config.copyFrom = existing.name;
                    requireSuccess(await storageAPI.saveCustomModel(config));
                    saved++;
                }
                await modelsChanged();
                setStatus(status, `Saved ${saved} models.`);
            }, status));
            provider.addEventListener('change', () => {
                apiUrl.value = preset().defaultUrl;
                apiFormat.value = preset().apiFormat;
                apiKey.value = '';
                apiKey.placeholder = preset().keyRequired ? 'Enter provider API key' : 'Optional for local servers';
                updateWorkersHint();
                choices = [];
                selected.clear();
                discoverySearch.value = '';
                showChoices();
                updateGoogleVisibility();
            });
        }
        catch (error) {
            setStatus(status, error instanceof Error ? error.message : 'Could not open model settings.', true);
        }
    }
    async function openImportExport(kind) {
        const { body, status } = openModal(kind === 'export' ? 'Export models' : 'Import models');
        body.append(element('p', 'agy-muted', kind === 'export'
            ? 'Credentials are removed from this export. Add API keys on the destination device.'
            : 'Paste a model configuration as JSON or an exported base64 string. Existing configurations are merged by name.'));
        const input = jsonField(body, 'Configuration', 'agy-config-json', undefined);
        input.rows = 14;
        if (kind === 'export') {
            input.readOnly = true;
            try {
                input.value = JSON.stringify(await electron_1.ipcRenderer.invoke('storage:export-custom-models'), null, 2);
            }
            catch (error) {
                setStatus(status, String(error), true);
            }
            const actions = element('div', 'agy-actions');
            actions.append(button('Select all', () => {
                input.focus();
                input.select();
            }, status), button('Copy JSON', async () => {
                await navigator.clipboard.writeText(input.value);
                setStatus(status, 'Configuration copied.');
            }, status));
            body.append(actions);
        }
        else {
            const file = field(body, 'Or choose a JSON file', 'agy-import-file', '', 'file');
            file.accept = '.json,application/json';
            file.addEventListener('change', async () => {
                try {
                    const selected = file.files?.[0];
                    if (!selected)
                        return;
                    if (selected.size > 2 * 1024 * 1024)
                        throw new Error('Configuration files must be smaller than 2 MB.');
                    input.value = await selected.text();
                }
                catch (error) {
                    setStatus(status, String(error), true);
                }
            });
            body.append(button('Import configuration', async () => {
                if (!input.value.trim())
                    throw new Error('Paste a configuration or choose a file first.');
                const result = requireSuccess(await electron_1.ipcRenderer.invoke('storage:import-custom-models', input.value.trim()));
                await modelsChanged();
                setStatus(status, `Imported ${result.count ?? 0} models. Add any missing API keys before use.`);
            }, status, true));
        }
    }
    async function discoverLocal() {
        const { body, status } = openModal('Local model servers');
        setStatus(status, 'Checking Ollama, LM Studio and llama.cpp on this computer…');
        try {
            const result = (await electron_1.ipcRenderer.invoke('storage:discover-local'));
            requireSuccess(result);
            if (!body.isConnected)
                return;
            setStatus(status, result.servers?.length
                ? 'Choose a server to configure its models.'
                : 'No local model servers were found. Start a server or add its URL manually.');
            for (const server of result.servers || []) {
                const row = element('div', 'agy-row');
                row.append(element('span', '', `${server.provider} · ${server.models.length} models`), element('div', 'agy-muted', server.apiUrl), button('Configure', () => openModelModal({ name: '', provider: server.provider, apiUrl: server.apiUrl, apiKey: 'none', externalModelName: '' }, 'discover'), status));
                body.append(row);
            }
        }
        catch (error) {
            setStatus(status, String(error), true);
        }
    }
    function openGenerationTest(model) {
        const { body, status } = openModal('Test model generation');
        body.append(element('p', '', `Model: ${model.displayName || model.externalModelName || model.name}`));
        body.append(element('p', 'agy-muted', 'Sends one “Reply with OK.” request with a 1024-token output limit using this model’s saved settings. Your provider may charge for the request. No conversation content is sent.'));
        body.append(button('Run generation test', async () => {
            setStatus(status, 'Sending a short generation test…');
            const result = requireSuccess(await storageAPI.testModelGeneration(model));
            setStatus(status, result.message || 'Generation succeeded.');
        }, status, true));
    }
    async function openDiagnostics() {
        const { body, status } = openModal('Proxy diagnostics');
        body.append(element('p', 'agy-muted', 'Measured requests from this proxy process only; restarting clears the history. Up to 200 completed requests are retained. Prompts, responses, URLs and credentials are not recorded. Gateway requests have separate history in its dashboard.'));
        const summary = element('div');
        summary.id = 'agy-diagnostics-summary';
        const search = field(body, 'Filter by model or provider', 'agy-diagnostics-search');
        const recent = element('div');
        const list = element('div');
        list.id = 'agy-diagnostics-requests';
        const output = element('textarea');
        output.id = 'agy-diagnostics-export';
        output.readOnly = true;
        output.rows = 8;
        output.hidden = true;
        output.setAttribute('aria-label', 'Exported diagnostic metadata');
        let snapshot;
        const token = (value) => (typeof value === 'number' ? value.toLocaleString() : 'unknown');
        const render = () => {
            if (!snapshot)
                return;
            const s = snapshot.summary;
            summary.replaceChildren(element('p', '', `${s.requests} completed · ${snapshot.active} active · ${s.succeeded} succeeded · ${s.failed} failed · ${s.cancelled} cancelled`));
            summary.append(element('p', 'agy-muted', s.measuredRequests
                ? `Provider-reported tokens: ${token(s.measuredInputRequests ? s.inputTokens : undefined)} input · ${token(s.measuredOutputRequests ? s.outputTokens : undefined)} output · ${token(s.measuredCachedRequests ? s.cachedTokens : undefined)} cached. Usage received for ${s.measuredRequests} of ${s.requests} requests; totals exclude unknown usage.`
                : 'Token usage: unknown. No provider-reported usage received yet.'));
            recent.replaceChildren();
            if (snapshot.recentModels.length)
                recent.append(element('p', 'agy-muted', `Recently used: ${snapshot.recentModels.join(' · ')}`));
            list.replaceChildren();
            const query = search.value.trim().toLowerCase();
            const rows = snapshot.requests.filter((r) => `${r.model} ${r.provider}`.toLowerCase().includes(query));
            if (!rows.length)
                list.append(element('p', 'agy-muted', 'No matching requests recorded.'));
            for (const r of rows) {
                const row = element('div', 'agy-row');
                row.append(element('strong', '', `${r.model} · ${r.provider}`));
                row.append(element('div', 'agy-muted', `${new Date(r.timestamp).toLocaleTimeString()} · ${r.outcome}${r.status ? ` (HTTP ${r.status})` : ''} · ${r.latencyMs} ms · ${r.kind === 'generation-test' ? 'generation test' : r.stream ? 'streaming' : 'request'}`));
                row.append(element('div', 'agy-muted', `Tokens: ${token(r.inputTokens)} input · ${token(r.outputTokens)} output · ${token(r.cachedTokens)} cached`));
                list.append(row);
            }
        };
        const refresh = async () => {
            snapshot = await electron_1.ipcRenderer.invoke('storage:get-diagnostics');
            requireSuccess(snapshot);
            if (body.isConnected)
                render();
        };
        search.addEventListener('input', render);
        const actions = element('div', 'agy-actions');
        actions.append(button('Refresh diagnostics', refresh, status), button('Export diagnostics', () => {
            output.value = JSON.stringify(snapshot, null, 2);
            output.hidden = false;
            output.focus();
            output.select();
        }, status), button('Clear diagnostic history', async () => {
            requireSuccess(await electron_1.ipcRenderer.invoke('storage:clear-diagnostics'));
            output.value = '';
            output.hidden = true;
            await refresh();
        }, status));
        body.append(summary, recent, actions, output, list);
        await refresh();
    }
    async function openGateway() {
        const { body, status } = openModal('Remote gateway');
        try {
            const saved = (await electron_1.ipcRenderer.invoke('storage:get-gateway'));
            if (!body.isConnected)
                return;
            body.append(element('p', 'agy-muted', 'Connect to your proxy gateway to import its model aliases and open its management dashboard.'));
            const url = field(body, 'Gateway URL', 'agy-gateway-url', saved?.url || '', 'url');
            const token = field(body, 'Gateway token', 'agy-gateway-token', saved?.token || '', 'password');
            const dashboard = field(body, 'Dashboard URL (optional)', 'agy-dashboard-url', saved?.dashboardUrl || '', 'url');
            const config = () => ({
                url: validUrl(url.value),
                token: token.value.trim(),
                dashboardUrl: dashboard.value.trim() ? validUrl(dashboard.value) : '',
            });
            const save = async () => {
                requireSuccess(await electron_1.ipcRenderer.invoke('storage:save-gateway', config()));
            };
            const actions = element('div', 'agy-actions');
            actions.append(button('Save connection', async () => {
                await save();
                setStatus(status, 'Gateway connection saved.');
            }, status, true), button('Test gateway', async () => {
                setStatus(status, 'Connecting…');
                const result = requireSuccess(await electron_1.ipcRenderer.invoke('storage:test-gateway', config()));
                setStatus(status, result.message || 'Gateway reachable and authentication accepted.');
            }, status), button('Import model aliases', async () => {
                await save();
                const result = requireSuccess(await electron_1.ipcRenderer.invoke('storage:import-gateway-models'));
                await modelsChanged();
                setStatus(status, `Imported ${result.count ?? 0} gateway models.`);
            }, status), button('Open dashboard', async () => {
                await save();
                requireSuccess(await electron_1.ipcRenderer.invoke('storage:open-gateway-dashboard'));
            }, status));
            body.append(actions);
        }
        catch (error) {
            setStatus(status, String(error), true);
        }
    }
    function findSettingsMount() {
        // Desktop settings are a modal over /c/...; older layouts use a settings route.
        // A chat span saying "MCP" is not evidence that the settings page is open.
        const settingsRoot = Array.from(document.querySelectorAll('[role="dialog"][aria-label="Settings"],.settings-modal-container,[data-testid="settings-view"],[data-testid="settings-panel"]')).find(isSettingsContent);
        const settingsRoute = /^\/settings(?:\/|$)/i.test(window.location.pathname) || /^#\/?settings(?:\/|\?|$)/i.test(window.location.hash);
        const root = settingsRoot || (settingsRoute ? document.body : null);
        if (!root)
            return null;
        const headings = Array.from(root.querySelectorAll('h1,h2,h3,h4,[role="heading"],div,span'));
        const heading = headings.find((node) => node.children.length === 0 &&
            /^(Models\s*(?:&|and)\s*Usage|Model Settings|MCP Servers|MCP)$/i.test(node.textContent?.trim() || '') &&
            isSettingsContent(node));
        if (heading) {
            const section = heading.closest('section');
            if (section && root.contains(section))
                return section;
            const panel = heading.closest('[role="tabpanel"]');
            if (panel && root.contains(panel))
                return panel;
            let content = heading;
            while (content.parentElement && content.parentElement !== root) {
                if (content.parentElement.classList.contains('overflow-y-auto'))
                    return content;
                content = content.parentElement;
            }
            const fallback = heading.parentElement?.parentElement || heading.parentElement;
            return fallback && root.contains(fallback) ? fallback : root;
        }
        const refresh = findRefreshButton(root);
        const legacy = refresh?.parentElement?.parentElement?.parentElement;
        if (legacy &&
            root.contains(legacy) &&
            isSettingsContent(legacy) &&
            /MCP|Model Context Protocol/i.test(legacy.textContent || ''))
            return legacy;
        return null;
    }
    function injectCustomModelsSection() {
        const mount = findSettingsMount();
        const existing = document.getElementById('agy-custom-models-section');
        if (existing && mount && existing.parentElement === mount)
            return;
        existing?.remove();
        if (!mount)
            return;
        installStyles();
        const section = element('section');
        section.id = 'agy-custom-models-section';
        section.setAttribute('aria-label', 'Custom Models');
        const header = element('div', 'agy-toolbar');
        const addModel = button('Add model', () => openModelModal(), undefined, true);
        addModel.id = 'agy-add-model';
        header.append(element('h2', '', 'Custom Models'), addModel);
        const actions = element('div', 'agy-actions');
        actions.append(button('Discover local', discoverLocal), button('Import', () => openImportExport('import')), button('Export', () => openImportExport('export')), button('Remote gateway', openGateway), button('Diagnostics', openDiagnostics));
        const search = field(section, 'Search models', 'agy-model-search', searchTerm, 'search');
        search.placeholder = 'Search by name, model ID or provider';
        search.addEventListener('input', () => {
            searchTerm = search.value.trim().toLowerCase();
            void renderCustomModelsList();
        });
        const content = element('div');
        content.id = 'agy-custom-models-content';
        const fleet = element('div', 'agy-fleet');
        fleet.id = 'agy-google-account-pool-section';
        fleet.setAttribute('aria-label', 'Google account fleet and quotas');
        fleet.hidden = true;
        const status = statusNode();
        status.id = 'agy-main-status';
        section.prepend(header, element('p', 'agy-muted', 'Provider connections, local models and remote gateways.'), actions);
        section.append(status, fleet, content);
        mount.append(section);
        void renderCustomModelsList();
    }
    let pickerSearch;
    function pickerVisible(menu) {
        if (!menu.isConnected)
            return false;
        for (let node = menu; node; node = node.parentElement) {
            if (node.hidden || node.getAttribute('aria-hidden') === 'true' || node.getAttribute('data-state') === 'closed')
                return false;
            const style = window.getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden')
                return false;
        }
        return true;
    }
    function checkModelPickerSearch() {
        if (pickerSearch) {
            if (pickerVisible(pickerSearch.menu)) {
                pickerSearch.update();
                return;
            }
            pickerSearch.cleanup();
            pickerSearch = undefined;
        }
        const menus = Array.from(document.querySelectorAll('[role="menu"], [role="listbox"]'));
        const menu = menus.find((candidate) => {
            if (!pickerVisible(candidate) || candidate.closest('#agy-modal-overlay, #agy-custom-models-section') ||
                candidate.parentElement?.closest('[role="menu"], [role="listbox"]') ||
                candidate.matches('[data-radix-menu-sub-content], [data-radix-dropdown-menu-sub-content]'))
                return false;
            const trigger = document.getElementById(candidate.getAttribute('aria-labelledby') || '');
            if (trigger?.closest('[role="menuitem"], [role="menuitemradio"]'))
                return false;
            const leaves = Array.from(candidate.querySelectorAll('*')).filter((node) => !node.children.length);
            const labels = leaves.map((node) => node.textContent?.trim() || '').filter(Boolean);
            return labels.slice(0, 2).includes('Model') && labels.some((label) => /^View\s+Usage$/i.test(label));
        });
        if (!menu)
            return;
        installStyles();
        const box = element('div', 'agy-model-search-box');
        const input = element('input', 'agy-model-search-input');
        input.type = 'search';
        input.placeholder = 'Search models…';
        input.setAttribute('aria-label', 'Search models');
        const empty = element('div', 'agy-model-no-results', 'No matching models');
        empty.hidden = true;
        box.append(input);
        const header = Array.from(menu.querySelectorAll('*')).find((node) => !node.children.length && node.textContent?.trim() === 'Model');
        (header || menu).insertAdjacentElement(header ? 'afterend' : 'afterbegin', box);
        box.after(empty);
        const displays = new Map();
        const items = () => Array.from(menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"], button'))
            .filter((node) => !node.parentElement?.closest('[role="menuitem"], [role="menuitemradio"], [role="option"]') &&
            !node.closest('.agy-model-search-box') && !/^View\s+Usage/i.test(node.textContent?.trim() || ''));
        const restore = (node) => {
            const old = displays.get(node);
            if (!old)
                return;
            if (old.value)
                node.style.setProperty('display', old.value, old.priority);
            else
                node.style.removeProperty('display');
            displays.delete(node);
        };
        const update = () => {
            const query = input.value.trim().toLowerCase();
            let matches = 0;
            for (const node of items()) {
                const matched = !query || (node.textContent || '').toLowerCase().includes(query);
                if (matched) {
                    if (displays.has(node))
                        restore(node);
                    if (pickerVisible(node))
                        matches++;
                }
                else if (!displays.has(node)) {
                    displays.set(node, { value: node.style.getPropertyValue('display'), priority: node.style.getPropertyPriority('display') });
                    node.style.setProperty('display', 'none', 'important');
                }
            }
            const hidden = !query || matches > 0;
            if (empty.hidden !== hidden)
                empty.hidden = hidden;
        };
        for (const event of ['pointerdown', 'mousedown', 'click'])
            box.addEventListener(event, (e) => e.stopPropagation());
        input.addEventListener('input', update);
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !input.value)
                return;
            event.stopPropagation();
            if (event.key === 'Escape') {
                event.preventDefault();
                input.value = '';
                update();
            }
            else if (event.key === 'Enter' || event.key === 'ArrowDown') {
                event.preventDefault();
                const first = items().find((node) => pickerVisible(node) && node.getAttribute('aria-disabled') !== 'true' && !node.disabled);
                if (event.key === 'Enter')
                    first?.click();
                else
                    first?.focus();
            }
        });
        pickerSearch = { menu, update, cleanup: () => { for (const node of displays.keys())
                restore(node); box.remove(); empty.remove(); } };
        setTimeout(() => { if (box.isConnected && pickerVisible(menu))
            input.focus(); }, 0);
    }
    function setupInjectionObserver() {
        injectCustomModelsSection();
        if (!document.body)
            return;
        checkModelPickerSearch();
        fleetTimer = setInterval(() => { void refreshFleetQuotas(); }, 30000);
        let pending;
        const observer = new MutationObserver(() => {
            if (pending)
                clearTimeout(pending);
            pending = setTimeout(() => {
                pending = undefined;
                injectCustomModelsSection();
                checkModelPickerSearch();
            }, 150);
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['hidden', 'aria-hidden', 'class', 'style', 'data-state'],
        });
        window.addEventListener('pagehide', () => {
            observer.disconnect();
            if (pending)
                clearTimeout(pending);
            if (fleetTimer)
                clearInterval(fleetTimer);
        }, { once: true });
    }
    // --- Network Interceptor for Model Injection --------------------------
    function isSafeToIntercept(url) {
        // Never touch the internal Connect-RPC LanguageServerService channel —
        // those responses are protocol-framed, not plain JSON, and rewriting
        // them corrupts the renderer's RPC client / store hydration.
        if (url.includes('exa.language_server_pb.'))
            return false;
        if (url.includes('/LanguageServerService/'))
            return false;
        return true;
    }
    function isJsonResponse(contentType) {
        return contentType?.split(';', 1)[0].trim().toLowerCase() === 'application/json';
    }
    const customModelsCache = { models: [], ts: 0 };
    function injectMissingCustomModels(parsed, customModels) {
        const key = ['models', 'availableModels', 'available_models'].find((name) => parsed[name] !== undefined) || 'models';
        const collection = parsed[key];
        // Preserve list/protocol shapes we do not own; the proxy handles array catalogs.
        if (collection !== undefined && (!collection || typeof collection !== 'object' || Array.isArray(collection)))
            return false;
        const modelsObj = (collection || {});
        const legacySlug = (model) => 'custom-' + String(model.externalModelName || model.name || '')
            .replace(/^models\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
        const usedLabels = new Set(Object.values(modelsObj).map((entry) => entry?.displayName).filter((label) => typeof label === 'string'));
        let changed = false;
        for (const model of customModels) {
            if (model.nativePickerAvailable === false)
                continue;
            const authoritative = typeof model.nativeCatalogId === 'string' && typeof model.nativeModelId === 'string';
            const slug = authoritative ? model.nativeCatalogId : legacySlug(model);
            // Compatibility with older IPC: never guess a shared external alias for effort variants.
            if (!authoritative && customModels.filter((other) => legacySlug(other) === slug).length !== 1)
                continue;
            const placeholder = authoritative ? model.nativeModelId : 'MODEL_PLACEHOLDER_M' +
                (400 + hashCodeStr(String(model.displayName || model.name || 'custom-model').toLowerCase()) % 200);
            const baseLabel = model.displayName || model.name;
            // The proxy is authoritative. Reinjection must not overwrite its capabilities or add a legacy duplicate.
            if (Object.prototype.hasOwnProperty.call(modelsObj, slug) || Object.entries(modelsObj).some(([id, entry]) => id.startsWith('custom-') && entry?.model === placeholder && entry.displayName === baseLabel))
                continue;
            let displayName = baseLabel;
            if (usedLabels.has(displayName) || customModels.filter((entry) => (entry.displayName || entry.name) === baseLabel).length > 1)
                displayName = `${baseLabel} (${String(model.name).replace(/^models\//, '')})`;
            let suffix = 2;
            while (usedLabels.has(displayName))
                displayName = `${baseLabel} (${String(model.name).replace(/^models\//, '')} #${suffix++})`;
            usedLabels.add(displayName);
            modelsObj[slug] = {
                displayName, recommended: true,
                maxTokens: model.nativeContextWindow || model.contextWindow || 1048576,
                maxOutputTokens: model.nativeMaxOutputTokens || model.maxOutputTokens || 4096,
                tokenizerType: 'LLAMA_WITH_SPECIAL', model: placeholder,
                apiProvider: 'API_PROVIDER_GOOGLE_GEMINI', modelProvider: 'MODEL_PROVIDER_GOOGLE',
                ...(authoritative && model.nativeModelExperiments ? { modelExperiments: model.nativeModelExperiments } : {}),
            };
            changed = true;
        }
        if (changed)
            parsed[key] = modelsObj;
        return changed;
    }
    async function getCustomModelsForInjection() {
        if (Date.now() - customModelsCache.ts < 30000)
            return customModelsCache.models;
        try {
            customModelsCache.models = (await storageAPI.getCustomModels()).filter((model) => model.enabled !== false);
            customModelsCache.ts = Date.now();
        }
        catch {
            /* ignore */
        }
        return customModelsCache.models;
    }
    // Intercept XHR to inject custom models into GetAvailableModels responses
    const origXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, async, username, password) {
        this._agy_url = typeof url === 'string' ? url : url.toString();
        this._agy_method = method;
        this._agy_async = async !== false;
        return origXHROpen.call(this, method, url, async !== false, username, password);
    };
    const origXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
        const url = this._agy_url || '';
        if ((url.includes('GetAvailableModels') || url.includes('fetchAvailableModels')) && isSafeToIntercept(url)) {
            // Warm the cache without delaying native XHR events. If it is not ready by
            // DONE, leave the response alone; load/readystatechange ordering must survive.
            if (this._agy_async)
                void getCustomModelsForInjection();
            const origOnReady = this.onreadystatechange;
            this.onreadystatechange = (ev) => {
                if (this.readyState === 4 &&
                    this.status === 200 &&
                    (this.responseType === '' || this.responseType === 'text') &&
                    isJsonResponse(this.getResponseHeader('content-type'))) {
                    const customModels = customModelsCache.models;
                    if (customModels && customModels.length > 0) {
                        try {
                            const responseText = this.responseText;
                            if (responseText && responseText.length > 10) {
                                const parsed = JSON.parse(responseText);
                                if (injectMissingCustomModels(parsed, customModels)) {
                                    // Override only a changed response; keep native event ordering intact.
                                    Object.defineProperty(this, 'responseText', { value: JSON.stringify(parsed), writable: true });
                                    Object.defineProperty(this, 'response', { value: JSON.stringify(parsed), writable: true });
                                }
                            }
                        }
                        catch {
                            /* ignore parse errors */
                        }
                    }
                }
                if (origOnReady)
                    origOnReady.call(this, ev);
            };
        }
        return origXHRSend.call(this, body);
    };
    // Intercept fetch responses for model endpoints
    const origFetch = window.fetch;
    window.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const response = await origFetch.call(window, input, init);
        if ((url.includes('GetAvailableModels') || url.includes('fetchAvailableModels')) &&
            isSafeToIntercept(url) &&
            response.ok) {
            if (!isJsonResponse(response.headers.get('content-type'))) {
                return response;
            }
            const customModels = await getCustomModelsForInjection();
            if (customModels && customModels.length > 0) {
                try {
                    const cloned = response.clone();
                    const text = await cloned.text();
                    if (text && text.length > 10) {
                        const parsed = JSON.parse(text);
                        if (!injectMissingCustomModels(parsed, customModels))
                            return response;
                        return new Response(JSON.stringify(parsed), {
                            status: response.status,
                            statusText: response.statusText,
                            headers: response.headers,
                        });
                    }
                }
                catch {
                    /* ignore parse errors */
                }
            }
        }
        return response;
    };
    function hashCodeStr(s) {
        let h = 5381;
        for (let i = 0; i < s.length; i++) {
            h = (h << 5) + h + s.charCodeAt(i);
            h = h & h;
        }
        return Math.abs(h);
    }
    // Start the observer
    setupInjectionObserver();
});
//# sourceMappingURL=customPreload.js.map
})();

(() => {
const exports = {};
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/** Independent sandbox-safe preload; deployment appends this module beside the settings preload. */
const electron_1 = require("electron");
window.addEventListener('DOMContentLoaded', () => {
    const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
    const composerSelector = '[data-testid="agent-input-box"], .no-focus-agent-input, ' +
        '[role="combobox"][contenteditable="true"][aria-label="Message input"]';
    const triggerSelector = '[data-testid="model-selector-trigger"], button[aria-label*="Select model" i], ' +
        'button[aria-label*="Choose model" i], button[aria-label*="Switch model" i]';
    const states = new Map();
    const toolbarParents = new Set();
    const style = document.createElement('style');
    style.textContent = '[data-agy-context-toolbar]:has(> [data-agy-context-ring]){display:inline-flex!important;align-items:center;gap:2px;max-width:100%}' +
        '[data-agy-context-toolbar]>[data-testid="model-selector-trigger"]{min-width:0;flex:0 1 auto}';
    document.head.append(style);
    const limits = new Map();
    let stopped = false;
    let debounce;
    let customNames = [];
    let namesAt = 0;
    let namesPending = false;
    const visible = (element) => {
        for (let current = element; current; current = current.parentElement) {
            if (current.hidden || current.getAttribute('aria-hidden') === 'true')
                return false;
            const style = window.getComputedStyle(current);
            if (style.display === 'none' || style.visibility === 'hidden')
                return false;
        }
        return true;
    };
    const text = (element) => (element.textContent || '').replace(/[▾▲▼◂▸◀▶]/g, '').replace(/\s+/g, ' ').trim();
    const idFrom = (value) => typeof value === 'string' && uuid.test(value) ? value : undefined;
    const composers = () => {
        // Native 2.23 also puts .no-focus-agent-input on the model toolbar itself.
        // A composer must contain an editor; a styling class alone is not an editor.
        const editorSelector = 'textarea, [role="combobox"][contenteditable="true"]';
        const candidates = Array.from(document.querySelectorAll(composerSelector))
            .filter((candidate) => visible(candidate) && (candidate.matches(editorSelector) || candidate.querySelector(editorSelector)));
        return candidates
            .filter((candidate) => !candidates.some((other) => other !== candidate && candidate.contains(other)))
            .sort((a, b) => Number(b.matches(editorSelector)) - Number(a.matches(editorSelector)));
    };
    function conversationIdentity(element) {
        for (const attr of ['data-conversation-id', 'data-cascade-id']) {
            const id = idFrom(element.getAttribute(attr));
            if (id)
                return id;
        }
        // Only named conversation properties are identities. Never accept arbitrary React UUIDs,
        // message IDs, tool IDs, storage entries, or the most recently modified conversation.
        try {
            const key = Object.keys(element).find((name) => name.startsWith('__reactFiber') || name.startsWith('__reactInternalInstance'));
            let fiber = key ? element[key] : undefined;
            for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
                const props = fiber.memoizedProps;
                if (!props || typeof props !== 'object')
                    continue;
                for (const value of [
                    props.conversationId, props.cascadeId, props.activeConversationId, props.currentConversationId,
                    props.conversation?.id, props.cascade?.id,
                ]) {
                    const id = idFrom(value);
                    if (id)
                        return id;
                }
            }
        }
        catch {
            /* Unknown React layout: leave identity unavailable. */
        }
        return undefined;
    }
    function readTarget(composer) {
        if (!composer.isConnected || !visible(composer))
            return undefined;
        let scope = composer;
        let trigger = scope.querySelector(triggerSelector);
        // Standalone 2.23 uses a Lexical contenteditable. Its model toolbar is a sibling,
        // so stop at the closest container with one model control instead of searching the page.
        if (composer.matches('[data-lexical-editor], [contenteditable="true"]')) {
            for (let depth = 0; !trigger && depth < 6 && scope.parentElement && scope.parentElement !== document.body; depth++) {
                scope = scope.parentElement;
                const controls = Array.from(scope.querySelectorAll(triggerSelector)).filter(visible);
                if (controls.length > 1)
                    break;
                if (controls.length === 1)
                    trigger = controls[0];
            }
        }
        if (!trigger) {
            trigger = Array.from(scope.querySelectorAll('button, [role="button"]')).find((button) => {
                if (button.hasAttribute('data-agy-context-ring') || !visible(button))
                    return false;
                const name = text(button);
                if (!name || name.length > 120 || /attach|add context|mention|send|submit/i.test(button.getAttribute('aria-label') || ''))
                    return false;
                return customNames.includes(name.toLowerCase()) ||
                    (/\b(gemini|claude|sonnet|opus|haiku|gpt|deepseek|qwen|llama|mistral)\b/i.test(name) &&
                        !!button.querySelector('svg, .codicon-chevron-down'));
            });
        }
        if (!trigger || !visible(trigger))
            return undefined;
        const modelName = text(trigger);
        if (!modelName)
            return undefined;
        let conversationId = conversationIdentity(composer) || conversationIdentity(trigger);
        const panel = composer.closest('[data-testid="conversation-view"], [data-testid="cascade-view"], [data-conversation-id], [data-cascade-id]');
        if (!conversationId && panel)
            conversationId = conversationIdentity(panel);
        // A route identifies only the sole composer; multi-pane/subagent views need their own IDs.
        if (!conversationId && composers().length === 1) {
            const route = `${window.location.pathname} ${window.location.hash}`;
            conversationId = idFrom(route.match(/(?:\/c\/|\/conversation\/)([a-f0-9-]{36})(?:[/?#\s]|$)/i)?.[1]);
        }
        return { trigger, modelName, conversationId, key: `${conversationId || ''}\n${modelName}` };
    }
    function render(state) {
        const { usage, target, ring } = state;
        const limit = usage?.maxTokens;
        const estimated = usage?.source === 'estimated' && typeof usage.currentTokens === 'number' && Number.isFinite(usage.currentTokens);
        const count = estimated ? usage.currentTokens : 0;
        let description = estimated
            ? `Visible transcript estimate: ~${count.toLocaleString('en-US')} tokens`
            : 'Context usage unavailable';
        if (limit)
            description += ` / ${limit.toLocaleString('en-US')} context limit (${usage?.limitSource === 'configured' ? 'configured' : 'public catalog'})`;
        description += '. Hidden prompts, tool definitions and images are not included; actual usage can be higher.';
        if (!target.conversationId)
            description += ' The open conversation could not be identified.';
        if (!limit)
            description += ' Click to look up the model limit in the public catalog.';
        if (ring.title !== description) {
            ring.title = description;
            ring.setAttribute('aria-label', description);
        }
        // This is visibly marked as an estimate; no fabricated measured percentage or safe/unsafe color.
        const fraction = estimated && limit ? Math.max(0, Math.min(1, count / limit)) : 0;
        const svg = `<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" opacity=".25" stroke-width="2"/><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="44" stroke-dashoffset="${(44 * (1 - fraction)).toFixed(2)}"/><text x="10" y="14" text-anchor="middle" font-size="12" fill="currentColor">${estimated ? '~' : '?'}</text></svg>`;
        if (ring.innerHTML !== svg)
            ring.innerHTML = svg;
        const parent = target.trigger.parentElement;
        if (parent) {
            if (!parent.hasAttribute('data-agy-context-toolbar'))
                parent.setAttribute('data-agy-context-toolbar', '');
            toolbarParents.add(parent);
        }
        if (target.trigger.nextElementSibling !== ring)
            target.trigger.insertAdjacentElement('afterend', ring);
    }
    async function request(state, force = false) {
        if (stopped || states.get(state.composer) !== state)
            return;
        if (state.inFlight) {
            if (force)
                state.queued = true;
            return;
        }
        if (!force && Date.now() - state.lastRequest < 3000)
            return;
        const requested = state.target;
        const discoverLimit = state.discover;
        state.discover = false;
        state.inFlight = true;
        state.lastRequest = Date.now();
        try {
            const usage = await electron_1.ipcRenderer.invoke('storage:get-chat-context-usage', {
                conversationId: requested.conversationId,
                modelName: requested.modelName,
                discoverLimit,
            });
            const current = readTarget(state.composer);
            if (stopped || !current || states.get(state.composer) !== state)
                return;
            if (current.key !== requested.key) {
                state.target = current;
                state.usage = undefined;
                state.lastRequest = 0;
                state.queued = true;
                render(state);
                return;
            }
            if (usage.conversationId && usage.conversationId !== requested.conversationId)
                return;
            state.target = current;
            if (typeof usage.maxTokens === 'number' && Number.isSafeInteger(usage.maxTokens) && usage.maxTokens > 0) {
                if (usage.limitSource === 'public-catalog')
                    limits.set(requested.modelName, { maxTokens: usage.maxTokens, limitSource: usage.limitSource, expires: Date.now() + 300000 });
            }
            else {
                const cached = limits.get(requested.modelName);
                if (cached && Date.now() < cached.expires)
                    Object.assign(usage, { maxTokens: cached.maxTokens, limitSource: cached.limitSource });
            }
            state.usage = usage;
            render(state);
        }
        catch {
            const current = readTarget(state.composer);
            if (states.get(state.composer) === state && current && current.key === requested.key) {
                state.usage = undefined;
                render(state);
            }
        }
        finally {
            state.inFlight = false;
            if (state.queued && !stopped && states.get(state.composer) === state) {
                state.queued = false;
                void request(state, true);
            }
        }
    }
    function refresh(force = false) {
        if (stopped)
            return;
        if (!namesPending && Date.now() - namesAt > 30000) {
            namesAt = Date.now();
            namesPending = true;
            void electron_1.ipcRenderer.invoke('storage:get-custom-models').then((models) => {
                customNames = Array.isArray(models) ? models.flatMap((model) => [model.displayName, model.name])
                    .filter((name) => typeof name === 'string').map((name) => name.toLowerCase()) : [];
                schedule();
            }).catch(() => { }).finally(() => { namesPending = false; });
        }
        // One trigger owns one ring, even if future native DOM changes provide
        // several plausible composer containers for the same model control.
        const targets = new Map();
        const triggers = new Set();
        for (const composer of composers()) {
            const target = readTarget(composer);
            if (target && !triggers.has(target.trigger)) {
                targets.set(composer, target);
                triggers.add(target.trigger);
            }
        }
        for (const [composer, state] of states) {
            if (!targets.has(composer)) {
                state.ring.remove();
                states.delete(composer);
            }
        }
        for (const [composer, target] of targets) {
            let state = states.get(composer);
            let changed = false;
            if (!state) {
                const ring = document.createElement('button');
                ring.type = 'button';
                ring.dataset.agyContextRing = '';
                ring.className = 'agy-context-usage';
                ring.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;flex:none;background:transparent;border:0;color:inherit;opacity:.75;padding:3px;cursor:help;';
                state = { composer, target, ring, inFlight: false, queued: false, discover: false, lastRequest: 0 };
                const ownState = state;
                ring.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    ownState.discover = !ownState.usage?.maxTokens;
                    void request(ownState, true);
                });
                ring.addEventListener('mousedown', (event) => event.stopPropagation());
                states.set(composer, state);
                changed = true;
            }
            else if (state.target.key !== target.key) {
                state.usage = undefined;
                state.lastRequest = 0;
                changed = true;
            }
            state.target = target;
            render(state);
            void request(state, force || changed);
        }
    }
    function schedule() {
        if (stopped || debounce)
            return;
        debounce = setTimeout(() => { debounce = undefined; refresh(); }, 100);
    }
    const observer = new MutationObserver((records) => {
        if (records.some((record) => !(record.target instanceof Element && record.target.closest('[data-agy-context-ring]'))))
            schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['class', 'hidden', 'aria-hidden', 'data-conversation-id', 'data-cascade-id'] });
    const focus = () => refresh(true);
    const route = () => refresh(true);
    window.addEventListener('focus', focus);
    window.addEventListener('popstate', route);
    window.addEventListener('hashchange', route);
    // Polling also catches transcript appends with no renderer DOM change and missed SPA route events.
    const poll = setInterval(() => refresh(), 5000);
    window.addEventListener('pagehide', () => {
        stopped = true;
        observer.disconnect();
        if (debounce)
            clearTimeout(debounce);
        clearInterval(poll);
        window.removeEventListener('focus', focus);
        window.removeEventListener('popstate', route);
        window.removeEventListener('hashchange', route);
        for (const state of states.values())
            state.ring.remove();
        states.clear();
        for (const parent of toolbarParents)
            parent.removeAttribute('data-agy-context-toolbar');
        toolbarParents.clear();
        style.remove();
    }, { once: true });
    refresh();
});
//# sourceMappingURL=contextUsagePreload.js.map
})();

/* __AG_CODEX_EFFORT_SLIDER_START__ */
try {
  const __agCodexSliderCode = "\"use strict\";\r\n\r\n/**\r\n * Antigravity Codex 风格推理等级滑条 (antigravity-codex-effort-slider)\r\n *\r\n * 设计目标与核心约束：\r\n * 1. 深度适配 Google Antigravity 原生架构（基于 @exa/agent-ui-toolkit 与 React Fiber 状态树），\r\n *    而非盲目照搬 DeepSeek Harness 的 DOM 假设。\r\n * 2. 在对话输入框底部工具栏、Agent 权限下拉 ([data-testid=\"permissions-selector-trigger\"]) 左侧\r\n *    常驻挂载紧凑「推理等级」滑条；屏蔽模型行冗余的右侧悬停档位子菜单，保留模型行右侧档位文字并随档位着色。\r\n * 3. 在菜单内点击上方模型行切换模型后自动收起下拉栏（与官方原生行为一致），\r\n *    单档位模型如 GPT-OSS 120B 自动置灰锁定。\r\n *    该行为由 ces-menu-autoclose 补丁改写（原版故意保持菜单常开）。\r\n * 4. 拖动滑条过程中，圆钮连续跟随指针；一旦滑过档位边界（无需等松手），立即通过 React Fiber\r\n *    调用官方 setModelConfigByLabelForConversation 切换真实档位，菜单保持常开。\r\n * 5. 针对 Antigravity 的三档模型 (Low / Medium / High) 采用 0 -> 0.5 -> 1.0 满配能量映射：\r\n *    - Low (0%)    : 纯蓝 (#4d93f8) 轨道 + 0 能量 + 0 星尘 + 蓝色文字\r\n *    - Medium (50%): 蓝紫过渡 (#9333ea) + 0.5 能量 + 11 颗星尘 (1x 闪烁速度) + 蓝紫文字\r\n *    - High (100%) : 深紫星云 (#4c1d95) + 流光扫掠 + 22 颗星尘全开 (2x 速度) + 紫色边框光晕 + 亮紫文字\r\n */\r\n(function (root, factory) {\r\n  try {\r\n    var exportsObj = factory(root);\r\n    if (typeof module === \"object\" && module && typeof module.exports === \"object\") {\r\n      module.exports = exportsObj;\r\n    }\r\n    if (root && typeof root === \"object\") {\r\n      root.AntigravityCodexEffortSlider = exportsObj;\r\n    }\r\n  } catch (err) {\r\n    // Factory error handled silently\r\n  }\r\n})(typeof globalThis !== \"undefined\" ? globalThis : typeof window !== \"undefined\" ? window : this, function (globalRoot) {\r\n\r\n  // ── 常量与默认几何参数 ──────────────────────────────────────────────────────\r\n  var STYLE_ELEMENT_ID = \"ag-codex-effort-slider-styles\";\r\n  var TRACK_HEIGHT = 28;\r\n  var KNOB_SIZE = 28;\r\n  var KNOB_RADIUS = KNOB_SIZE / 2;\r\n  var BASE_SPEEDUP = 4;\r\n\r\n  // Antigravity 默认三档模型 (Low / Medium / High) 无 Off 档，因此能量起点为 0、中点为 0.5；\r\n  // 若遇到首档为 Off 的四档模型 (Off / Low / High / Max)，energyStopsFor 会自动返回 { start: 1/3, end: 2/3 }。\r\n  var ENERGY_START = 0;\r\n  var ENERGY_END = 0.5;\r\n  var MIN_HEIGHT_SLOTS = 2;\r\n\r\n  // Antigravity 官方推理档位枚举与展示名映射（对应 main.js 中的 DXb / EXb / GXb）。\r\n  // default / none / minimal 由代理按会话下发，原生选择器不认识这些标签，\r\n  // 因此它们只出现在滑条上，不会变成重复的模型行。\r\n  var AG_EFFORT_ORDER = [\"default\", \"none\", \"minimal\", \"low\", \"medium\", \"high\", \"xhigh\", \"max\"];\r\n  var AG_EFFORT_LABELS = {\r\n    default: \"Default\",\r\n    off: \"Off\",\r\n    none: \"Off\",\r\n    minimal: \"Minimal\",\r\n    low: \"Low\",\r\n    medium: \"Medium\",\r\n    high: \"High\",\r\n    xhigh: \"Extra\",\r\n    max: \"Max\"\r\n  };\r\n  var AG_MODEL_LABEL_RE = /^(.*?)\\s*\\((off|none|default|minimal|low|medium|high|xhigh|extra|max)(?:\\s+thinking)?\\)\\s*$/i;\r\n\r\n  // Claude 专属主题常量（6×60 点阵、1.6s 从右至左扫掠、Capsule 胶囊滑块）\r\n  var CLAUDE_CELL = 28 / 6; // ≈ 4.67px\r\n  var CLAUDE_ROWS = 6;\r\n  var CLAUDE_SWEEP_MS = 1600;\r\n  var CLAUDE_KNOB_W = 24;\r\n  var CLAUDE_KNOB_H = 30;\r\n  var CLAUDE_KNOB_R = 7;\r\n\r\n  function isClaudeModel(name) {\r\n    if (!name || typeof name !== \"string\") return false;\r\n    return /claude/i.test(name);\r\n  }\r\n\r\n  // ── 连续物理运动参数 ────────────────────────────────────────────────────────\r\n  // full: 完整星云阻尼变速动画；fast: 快速 ~70ms 跟手吸附（默认）；quick: 0 动画直接跳格\r\n  var MOTION = Object.freeze({\r\n    maxSpeed: 3.2,\r\n    accel: 28,\r\n    decel: 18,\r\n    snapEps: 0.0015,\r\n    velEps: 0.01\r\n  });\r\n\r\n  var MOTION_REDUCED = Object.freeze({\r\n    maxSpeed: 1e6,\r\n    accel: 1e9,\r\n    decel: 1e9,\r\n    snapEps: 1e-4,\r\n    velEps: 1e6\r\n  });\r\n\r\n  var MOTION_FAST = Object.freeze({\r\n    maxSpeed: 18,\r\n    accel: 260,\r\n    decel: 180,\r\n    snapEps: 0.002,\r\n    velEps: 0.04\r\n  });\r\n\r\n  var RELEASE_PROJECT_S = 0.09;\r\n  var POINTER_SPEED_EMA = 0.45;\r\n  var POINTER_STALE_S = 0.05;\r\n  var POINTER_SPEED_TAU = 0.035;\r\n\r\n  // ── 用户设置 Schema 与持久化 ────────────────────────────────────────────────\r\n  var SETTINGS_KEY = \"ag.codexEffortSlider.settings.v1\";\r\n  var LEGACY_SETTINGS_KEY = \"dsh.codexEffortSlider.settings.v1\";\r\n  var SETTINGS_EVENT = \"ag:codex-effort-slider:settings\";\r\n  var SETTINGS_VERSION = 1;\r\n\r\n  var SETTINGS_SCHEMA = Object.freeze([\r\n    Object.freeze({\r\n      key: \"motion\",\r\n      label: \"动画效果\",\r\n      defaultValue: \"fast\",\r\n      options: Object.freeze([\r\n        Object.freeze({ value: \"fast\", label: \"快速动画\", hint: \"拨过 1/3 即切档 · ~70ms 快速吸附\" }),\r\n        Object.freeze({ value: \"quick\", label: \"简洁动画\", hint: \"无过渡 · 直接跳档\" }),\r\n        Object.freeze({ value: \"full\", label: \"完整动画\", hint: \"匀变速追赶 + 星尘渐亮\" })\r\n      ])\r\n    }),\r\n    Object.freeze({\r\n      key: \"ticks\",\r\n      label: \"已到达档位的刻度点\",\r\n      defaultValue: \"highlight\",\r\n      options: Object.freeze([\r\n        Object.freeze({ value: \"highlight\", label: \"亮白显示\", hint: \"默认 · 已滑过档位高亮\" }),\r\n        Object.freeze({ value: \"dim\", label: \"与未到达同色\", hint: \"所有刻度点保持柔和半透明\" }),\r\n        Object.freeze({ value: \"hidden\", label: \"隐藏\", hint: \"不显示任何刻度点\" })\r\n      ])\r\n    })\r\n  ]);\r\n\r\n  function schemaDefaults() {\r\n    var out = { v: SETTINGS_VERSION };\r\n    for (var i = 0; i < SETTINGS_SCHEMA.length; i += 1) {\r\n      var item = SETTINGS_SCHEMA[i];\r\n      out[item.key] = item.defaultValue;\r\n    }\r\n    return out;\r\n  }\r\n\r\n  function normalizeSettings(raw) {\r\n    var base = schemaDefaults();\r\n    if (!raw || typeof raw !== \"object\") return base;\r\n    for (var i = 0; i < SETTINGS_SCHEMA.length; i += 1) {\r\n      var item = SETTINGS_SCHEMA[i];\r\n      var candidate = raw[item.key];\r\n      var matched = false;\r\n      for (var j = 0; j < item.options.length; j += 1) {\r\n        if (item.options[j].value === candidate) {\r\n          matched = true;\r\n          break;\r\n        }\r\n      }\r\n      if (matched) base[item.key] = candidate;\r\n    }\r\n    if (!raw.motion && raw.reducedMotion === true) {\r\n      base.motion = \"quick\";\r\n    }\r\n    return base;\r\n  }\r\n\r\n  function resolveStorage(win) {\r\n    var w = win || (typeof window !== \"undefined\" ? window : globalRoot);\r\n    try {\r\n      if (w && w.localStorage) return w.localStorage;\r\n    } catch (err) {\r\n      // 沙箱或隐私上下文禁用 localStorage 时降级为内存模式\r\n    }\r\n    return null;\r\n  }\r\n\r\n  function readSettings(win) {\r\n    var store = resolveStorage(win);\r\n    if (!store) return schemaDefaults();\r\n    try {\r\n      var text = store.getItem(SETTINGS_KEY) || store.getItem(LEGACY_SETTINGS_KEY);\r\n      if (!text) return schemaDefaults();\r\n      return normalizeSettings(JSON.parse(text));\r\n    } catch (err) {\r\n      return schemaDefaults();\r\n    }\r\n  }\r\n\r\n  function writeSettings(patch, win) {\r\n    var w = win || (typeof window !== \"undefined\" ? window : globalRoot);\r\n    var current = readSettings(w);\r\n    var merged = Object.assign({}, current, patch || {});\r\n    var next = normalizeSettings(merged);\r\n    var store = resolveStorage(w);\r\n    if (store) {\r\n      try {\r\n        store.setItem(SETTINGS_KEY, JSON.stringify(next));\r\n      } catch (err) {\r\n        // 忽略配额或权限异常\r\n      }\r\n    }\r\n    try {\r\n      if (w && typeof w.dispatchEvent === \"function\" && typeof w.CustomEvent === \"function\") {\r\n        w.dispatchEvent(new w.CustomEvent(SETTINGS_EVENT, { detail: next }));\r\n      }\r\n    } catch (err) {\r\n      // 忽略无 CustomEvent 构造器的测试环境\r\n    }\r\n    return next;\r\n  }\r\n\r\n  function resetSettings(win) {\r\n    return writeSettings(schemaDefaults(), win);\r\n  }\r\n\r\n  function onSettingsChange(listener, win) {\r\n    var w = win || (typeof window !== \"undefined\" ? window : globalRoot);\r\n    if (!w || typeof w.addEventListener !== \"function\") return function () {};\r\n    function handleCustom(ev) {\r\n      listener(ev && ev.detail ? normalizeSettings(ev.detail) : readSettings(w));\r\n    }\r\n    function handleStorage(ev) {\r\n      if (!ev || (ev.key !== SETTINGS_KEY && ev.key !== LEGACY_SETTINGS_KEY)) return;\r\n      listener(readSettings(w));\r\n    }\r\n    w.addEventListener(SETTINGS_EVENT, handleCustom);\r\n    w.addEventListener(\"storage\", handleStorage);\r\n    return function () {\r\n      w.removeEventListener(SETTINGS_EVENT, handleCustom);\r\n      w.removeEventListener(\"storage\", handleStorage);\r\n    };\r\n  }\r\n\r\n  function prefersReducedMotion(win) {\r\n    var w = win || (typeof window !== \"undefined\" ? window : globalRoot);\r\n    try {\r\n      if (w && typeof w.matchMedia === \"function\") {\r\n        var mq = w.matchMedia(\"(prefers-reduced-motion: reduce)\");\r\n        if (mq && mq.matches) return true;\r\n      }\r\n    } catch (err) {\r\n      // 忽略不支持 matchMedia 的环境\r\n    }\r\n    return false;\r\n  }\r\n\r\n  function motionMode(win, explicitSettings) {\r\n    if (prefersReducedMotion(win)) return \"quick\";\r\n    var s = explicitSettings ? normalizeSettings(explicitSettings) : readSettings(win);\r\n    return s.motion || \"fast\";\r\n  }\r\n\r\n  function motionParamsForMode(mode) {\r\n    if (mode === \"quick\") return MOTION_REDUCED;\r\n    if (mode === \"full\") return MOTION;\r\n    return MOTION_FAST;\r\n  }\r\n\r\n  // ── 诊断环形缓冲区 ──────────────────────────────────────────────────────────\r\n  var TRACE_CAPACITY = 200;\r\n  var traceRingBuffer = [];\r\n\r\n  function tracePush(type, detail) {\r\n    var entry = { t: Date.now(), type: String(type || \"event\") };\r\n    if (detail && typeof detail === \"object\") {\r\n      var keys = Object.keys(detail);\r\n      for (var i = 0; i < keys.length; i += 1) {\r\n        entry[keys[i]] = detail[keys[i]];\r\n      }\r\n    }\r\n    traceRingBuffer.push(entry);\r\n    if (traceRingBuffer.length > TRACE_CAPACITY) {\r\n      traceRingBuffer.splice(0, traceRingBuffer.length - TRACE_CAPACITY);\r\n    }\r\n  }\r\n\r\n  function dumpTrace(win) {\r\n    var w = win || (typeof window !== \"undefined\" ? window : globalRoot);\r\n    return {\r\n      plugin: \"antigravity-codex-effort-slider@1.2.1\",\r\n      time: new Date().toISOString(),\r\n      ua: w && w.navigator ? w.navigator.userAgent : \"node\",\r\n      settings: readSettings(w),\r\n      events: traceRingBuffer.slice()\r\n    };\r\n  }\r\n\r\n  function traceClear() {\r\n    traceRingBuffer.length = 0;\r\n  }\r\n\r\n  // ── 数学、物理与刻度换算 ────────────────────────────────────────────────────\r\n  function clamp01(value) {\r\n    var num = Number(value);\r\n    if (!Number.isFinite(num) || num <= 0) return 0;\r\n    if (num >= 1) return 1;\r\n    return num;\r\n  }\r\n\r\n  function clampAbs(value, limit) {\r\n    var lim = Math.max(0, Number(limit) || 0);\r\n    var num = Number(value) || 0;\r\n    if (num > lim) return lim;\r\n    if (num < -lim) return -lim;\r\n    return num;\r\n  }\r\n\r\n  function pctFromIndex(index, count) {\r\n    var n = Number(count) || 0;\r\n    if (n <= 1) return 0;\r\n    var idx = Math.max(0, Math.min(n - 1, Math.round(Number(index) || 0)));\r\n    return idx / (n - 1);\r\n  }\r\n\r\n  function indexFromPct(pct, count) {\r\n    var n = Number(count) || 0;\r\n    if (n <= 1) return 0;\r\n    var p = clamp01(pct);\r\n    return Math.max(0, Math.min(n - 1, Math.round(p * (n - 1))));\r\n  }\r\n\r\n  /**\r\n   * 迟滞棘轮分档器（Hysteresis Detent）：\r\n   * - 向新档位方向推进过 1/3 格宽即刻触发跳档，保证「拖过边界立即切档」的轻快手感；\r\n   * - 往回退则需要退过 2/3 格宽（留出 [1/3, 2/3] 迟滞带），防止手指停在边界附近时左右抖动。\r\n   */\r\n  function detentTargetIndex(currentIndex, ptrPct, count) {\r\n    var n = Number(count) || 0;\r\n    if (n <= 1) return 0;\r\n    var p = clamp01(ptrPct);\r\n    if (typeof currentIndex !== \"number\" || currentIndex < 0 || currentIndex >= n) {\r\n      return indexFromPct(p, n);\r\n    }\r\n    var step = 1 / (n - 1);\r\n    var forwardThreshold = 1 / 3;\r\n    var idx = currentIndex;\r\n    var curCenter = idx * step;\r\n    if (p >= curCenter) {\r\n      while (idx < n - 1 && p >= (idx + forwardThreshold) * step - 1e-9) {\r\n        idx += 1;\r\n      }\r\n    } else {\r\n      while (idx > 0 && p <= (idx - forwardThreshold) * step + 1e-9) {\r\n        idx -= 1;\r\n      }\r\n    }\r\n    return idx;\r\n  }\r\n\r\n  function knobOffsetOf(pct, radiusPx) {\r\n    var p = clamp01(pct);\r\n    var r = typeof radiusPx === \"number\" && Number.isFinite(radiusPx) ? radiusPx : KNOB_RADIUS;\r\n    return \"calc(\" + r + \"px + (100% - \" + (r * 2) + \"px) * \" + p + \")\";\r\n  }\r\n\r\n  function motionSettled(state, params) {\r\n    if (!state) return true;\r\n    var cfg = params || MOTION;\r\n    var dist = Math.abs((Number(state.target) || 0) - (Number(state.x) || 0));\r\n    var vel = Math.abs(Number(state.v) || 0);\r\n    return dist <= cfg.snapEps && vel <= cfg.velEps;\r\n  }\r\n\r\n  /**\r\n   * 连续物理步进器：基于刹车距离 v^2 / (2 * decel) 平滑追赶 target，无过冲回弹\r\n   */\r\n  function motionStep(state, dtSeconds, params) {\r\n    if (!state) return;\r\n    var cfg = params || MOTION;\r\n    var dt = Number(dtSeconds);\r\n    if (!Number.isFinite(dt) || dt <= 0) return;\r\n    if (dt > 0.05) dt = 0.05;\r\n\r\n    var target = clamp01(state.target);\r\n    var x = clamp01(state.x);\r\n    var v = Number(state.v) || 0;\r\n    var diff = target - x;\r\n    var dist = Math.abs(diff);\r\n\r\n    if (dist <= cfg.snapEps && Math.abs(v) <= cfg.velEps) {\r\n      state.x = target;\r\n      state.v = 0;\r\n      state.a = 0;\r\n      return;\r\n    }\r\n\r\n    var dir = diff >= 0 ? 1 : -1;\r\n    var movingTowards = v * dir >= 0;\r\n    var stopDist = (v * v) / (2 * cfg.decel);\r\n    var a = 0;\r\n\r\n    if (!movingTowards) {\r\n      a = dir * cfg.accel;\r\n    } else if (stopDist >= dist) {\r\n      a = -dir * cfg.decel;\r\n    } else {\r\n      a = dir * cfg.accel;\r\n    }\r\n\r\n    var nextV = clampAbs(v + a * dt, cfg.maxSpeed);\r\n    var nextX = x + nextV * dt;\r\n\r\n    // 防止单步跨越目标造成振荡\r\n    if ((target - x) * (target - nextX) <= 0 && Math.abs(nextV) <= cfg.maxSpeed) {\r\n      state.x = target;\r\n      state.v = 0;\r\n      state.a = 0;\r\n      return;\r\n    }\r\n\r\n    if (nextX <= 0) {\r\n      state.x = 0;\r\n      state.v = Math.max(0, nextV);\r\n      state.a = a;\r\n      return;\r\n    }\r\n    if (nextX >= 1) {\r\n      state.x = 1;\r\n      state.v = Math.min(0, nextV);\r\n      state.a = a;\r\n      return;\r\n    }\r\n\r\n    state.x = nextX;\r\n    state.v = nextV;\r\n    state.a = a;\r\n  }\r\n\r\n  function decayPointerSpeed(rawSpeed, idleSeconds) {\r\n    var v = Number(rawSpeed) || 0;\r\n    var idle = Number(idleSeconds) || 0;\r\n    if (idle <= POINTER_STALE_S) return v;\r\n    var decay = Math.exp(-(idle - POINTER_STALE_S) / POINTER_SPEED_TAU);\r\n    var out = v * decay;\r\n    return Math.abs(out) < 1e-4 ? 0 : out;\r\n  }\r\n\r\n  function releaseIndexFor(ptrPct, rawSpeed, idleSeconds, count) {\r\n    var v = decayPointerSpeed(rawSpeed, idleSeconds);\r\n    var projected = clamp01((Number(ptrPct) || 0) + v * RELEASE_PROJECT_S);\r\n    return indexFromPct(projected, count);\r\n  }\r\n\r\n  // ── 22 颗黄金分割确定性星尘与色彩引擎（对齐 dsh-codex-effort-slider 右向左横穿星空） ──\r\n  var PARTICLE_COUNT = 22;\r\n  var STARFIELD_DURATION_MEAN = 1.5;\r\n  var STARFIELD_DURATION_SPREAD = 0.08;\r\n  var STARFIELD_MIN = 0.5;\r\n  var GOLDEN_RATIO = 0.6180339887498949;\r\n  var MAX_SPEED_FACTOR = 2;\r\n  var REDUCED_MOTION_SLOWDOWN = 2.6;\r\n\r\n  /** 确定性伪随机 [0,1)：不用 Math.random，每次渲染完全一致且可离线断言 */\r\n  function starHash01(index, salt) {\r\n    var value = ((index + 1) * (salt || 1) * 2654435761) % 4294967296;\r\n    return ((value >>> 8) % 1000) / 1000;\r\n  }\r\n\r\n  /**\r\n   * 22 颗星尘粒子（形态 = 3px 圆点；运动 = 从右向左连续横穿已填充轨道，不消失、不上下飘动）：\r\n   * - 相位：黄金比低差异序列（任意前缀均匀铺开）\r\n   * - 高度：与相位排名解耦的确定性哈希排列，且相位相邻两星高度至少差 MIN_HEIGHT_SLOTS 槽\r\n   */\r\n  var PARTICLES = (function buildParticles() {\r\n    var count = PARTICLE_COUNT;\r\n    var minSlots = 3;\r\n    var out = [];\r\n    var i;\r\n    for (i = 0; i < count; i += 1) {\r\n      var b = STARFIELD_MIN + (1 - STARFIELD_MIN) * starHash01(i, 61);\r\n      out.push({\r\n        id: i,\r\n        y: 0,\r\n        phase: ((i + 1) * GOLDEN_RATIO) % 1,\r\n        threshold: i / count,\r\n        brightness: Math.round(b * 1000) / 1000\r\n      });\r\n    }\r\n    var byPhase = [];\r\n    for (i = 0; i < count; i += 1) byPhase.push(i);\r\n    byPhase.sort(function (a, b) {\r\n      return out[a].phase - out[b].phase;\r\n    });\r\n    var slots = null;\r\n    for (var salt = 71; salt < 4000 && slots === null; salt += 1) {\r\n      var candidate = [];\r\n      for (i = 0; i < count; i += 1) candidate.push(i);\r\n      candidate.sort(function (a, b) {\r\n        var ha = starHash01(a, salt);\r\n        var hb = starHash01(b, salt);\r\n        return ha === hb ? a - b : ha - hb;\r\n      });\r\n      var ok = true;\r\n      for (var k = 1; k < count && ok; k += 1) {\r\n        if (Math.abs(candidate[k] - candidate[k - 1]) < minSlots) ok = false;\r\n      }\r\n      if (ok) slots = candidate;\r\n    }\r\n    if (slots === null) {\r\n      slots = [];\r\n      for (i = 0; i < count; i += 1) slots.push((i * 5) % count);\r\n    }\r\n    for (var rank = 0; rank < count; rank += 1) {\r\n      var yVal = 8 + (slots[rank] / (count - 1)) * 84;\r\n      out[byPhase[rank]].y = Math.round(yVal * 100) / 100;\r\n    }\r\n    for (i = 0; i < count; i += 1) {\r\n      Object.freeze(out[i]);\r\n    }\r\n    return Object.freeze(out);\r\n  })();\r\n\r\n  function isOffLevel(text) {\r\n    if (text === null || text === undefined) return false;\r\n    if (typeof text === \"object\") {\r\n      return isOffLevel(text.id || text.name || text.effort || text.label || \"\");\r\n    }\r\n    var s = String(text).trim().toLowerCase();\r\n    if (!s) return false;\r\n    return (\r\n      s === \"off\" ||\r\n      s === \"none\" ||\r\n      s === \"disabled\" ||\r\n      s === \"0\" ||\r\n      s === \"关闭\" ||\r\n      s === \"关\" ||\r\n      s === \"不推理\" ||\r\n      s === \"无\"\r\n    );\r\n  }\r\n\r\n  /* ── Claude Ultracode 像素点阵抖动引擎 ──────────────────────────────── */\r\n  function hash01(a, b, c) {\r\n    var h = (a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 1274126177;\r\n    h = (h ^ (h >>> 13)) * 1274126177;\r\n    h = h ^ (h >>> 16);\r\n    return ((h >>> 0) % 100000) / 100000;\r\n  }\r\n\r\n  function ditherAlphaAt(x, w, col, row) {\r\n    var t = clamp01(x / Math.max(1, w));\r\n    var ramp = 0.92 + 0.08 * t;\r\n    var jitter = 0.25 + 0.75 * hash01(col, row, 7);\r\n    return clamp01(ramp * jitter);\r\n  }\r\n\r\n  function fillRoundRect(ctx, x, y, w, h, r) {\r\n    ctx.beginPath();\r\n    ctx.moveTo(x + r, y);\r\n    ctx.lineTo(x + w - r, y);\r\n    ctx.quadraticCurveTo(x + w, y, x + w, y + r);\r\n    ctx.lineTo(x + w, y + h - r);\r\n    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);\r\n    ctx.lineTo(x + r, y + h);\r\n    ctx.quadraticCurveTo(x, y + h, x, y + h - r);\r\n    ctx.lineTo(x, y + r);\r\n    ctx.quadraticCurveTo(x, y, x + r, y);\r\n    ctx.closePath();\r\n    ctx.fill();\r\n  }\r\n\r\n  function valueNoise(col, row, timeSec, speed, seed) {\r\n    var tt = timeSec * speed + hash01(col, row, seed) * 17;\r\n    var step = Math.floor(tt);\r\n    var f = tt - step;\r\n    var e = f * f * (3 - 2 * f);\r\n    var a = hash01(col, row, (step % 997) + seed * 11);\r\n    var b = hash01(col, row, ((step + 1) % 997) + seed * 11);\r\n    return a + (b - a) * e;\r\n  }\r\n\r\n  var mergeCache = null;\r\n  var mergeCacheKey = \"\";\r\n  function getMergeMap(cols, rows) {\r\n    var key = cols + \"x\" + rows;\r\n    if (mergeCache && mergeCacheKey === key) return mergeCache;\r\n    var map = new Uint8Array(cols * rows);\r\n    for (var r = 0; r < rows; r += 1) {\r\n      for (var c = 0; c < cols; c += 1) {\r\n        var i = r * cols + c;\r\n        if (map[i]) continue;\r\n        var h = hash01(c, r, 91);\r\n        if (h < 0.02 && c + 1 < cols && r + 1 < rows && !map[i + 1] && !map[i + cols] && !map[i + cols + 1]) {\r\n          map[i] = 1; map[i + 1] = 2; map[i + cols] = 2; map[i + cols + 1] = 2;\r\n        } else if (h < 0.06 && c + 1 < cols && !map[i + 1]) {\r\n          map[i] = 3; map[i + 1] = 2;\r\n        } else if (h < 0.08 && r + 1 < rows && !map[i + cols]) {\r\n          map[i] = 4; map[i + cols] = 2;\r\n        }\r\n      }\r\n    }\r\n    mergeCache = map;\r\n    mergeCacheKey = key;\r\n    return map;\r\n  }\r\n\r\n  function surfaceIsDark(win, doc) {\r\n    try {\r\n      var d = doc || (typeof document !== \"undefined\" ? document : null);\r\n      var w = win || (typeof window !== \"undefined\" ? window : globalRoot);\r\n      if (!d || !d.body || !w) return true;\r\n      if (d.documentElement && d.documentElement.classList.contains(\"dark\")) return true;\r\n      if (d.body && d.body.classList.contains(\"dark\")) return true;\r\n      var bg = (w.getComputedStyle && w.getComputedStyle(d.body).backgroundColor) || \"\";\r\n      var parts = bg.match(/[\\d.]+/g);\r\n      if (!parts || parts.length < 3) return true;\r\n      if (parts.length > 3 && Number(parts[3]) < 0.5) return true;\r\n      var luminance = (0.2126 * Number(parts[0]) + 0.7152 * Number(parts[1]) + 0.0722 * Number(parts[2])) / 255;\r\n      return luminance < 0.5;\r\n    } catch (err) {\r\n      return true;\r\n    }\r\n  }\r\n\r\n  /**\r\n   * Claude 点阵绘制。intensity ∈ [0,1] 连续控制特效强度（中档约 0.35，最高档 1）：\r\n   * - 底晕 wash 透明度按 intensity 缩放；\r\n   * - 像素密度：按每格固定哈希做确定性稀疏剔除，intensity 越低保留越少（不会随帧闪烁）；\r\n   * - 像素亮度：整体 alpha 乘以 (0.45 + 0.55 * intensity)。\r\n   * intensity = 1 时三项系数均为 1，输出与旧版完全一致。\r\n   */\r\n  function paintDither(ctx, w, h, dark, progress, timeSec, intensity) {\r\n    if (!ctx) return;\r\n    var strength = typeof intensity === \"number\" ? clamp01(intensity) : 1;\r\n    ctx.clearRect(0, 0, w, h);\r\n    if (strength <= 0 || w <= 0) return;\r\n    // 密度阈值：strength=1 → 1.0（全保留）；strength=0.35 → ~0.51（约一半格子）\r\n    var keepRatio = strength >= 1 ? 1 : 0.25 + 0.75 * strength;\r\n    var alphaMul = 0.45 + 0.55 * strength;\r\n    var k = 1 - progress;\r\n    var s1 = Math.max(0, Math.min(1, k - 0.08));\r\n    var s2 = Math.max(s1, Math.min(1, k + 0.18));\r\n    var wash = ctx.createLinearGradient(0, 0, w, 0);\r\n    if (dark) {\r\n      wash.addColorStop(0, \"rgba(112, 78, 162, 0)\");\r\n      wash.addColorStop(s1, \"rgba(112, 78, 162, 0)\");\r\n      wash.addColorStop(s2, \"rgba(118, 84, 169, 0.3)\");\r\n      wash.addColorStop(1, \"rgba(116, 84, 170, 0.75)\");\r\n    } else {\r\n      wash.addColorStop(0, \"rgba(142, 118, 192, 0)\");\r\n      wash.addColorStop(s1, \"rgba(142, 118, 192, 0)\");\r\n      wash.addColorStop(s2, \"rgba(142, 118, 192, 0.45)\");\r\n      wash.addColorStop(1, \"rgba(142, 118, 192, 1)\");\r\n    }\r\n    ctx.globalAlpha = strength;\r\n    ctx.fillStyle = wash;\r\n    ctx.fillRect(0, 0, w, h);\r\n\r\n    var purple = dark ? [208, 192, 246] : [150, 130, 205];\r\n    var cell = h / 6 > 0 ? h / 6 : CLAUDE_CELL;\r\n    var cols = Math.ceil(w / cell);\r\n    var rows = 6;\r\n\r\n    for (var col = 0; col < cols; col += 1) {\r\n      var x = col * cell;\r\n      var t = clamp01(x / Math.max(1, w));\r\n      var fade = clamp01((t - 0.02) / 0.48);\r\n      for (var row = 0; row < rows; row += 1) {\r\n        // 确定性稀疏：同一格在同一强度下始终同样保留/剔除，避免拖动时整片闪烁\r\n        if (keepRatio < 1 && hash01(col, row, 101) > keepRatio) continue;\r\n        var base = ditherAlphaAt(x, w, col, row) * alphaMul;\r\n        if (base < 0.05) continue;\r\n        var front = 1 - progress;\r\n        var edgeJit = (hash01(col, row, 31) - 0.5) * 0.05;\r\n        if (t < front + edgeJit) continue;\r\n        var appear = (0.35 + 0.65 * clamp01((t - front - edgeJit) / 0.04)) * (dark ? 1 : alphaMul);\r\n\r\n        var rowWaves = 3 + Math.floor(hash01(0, row, 47) * 5);\r\n        var rowSpeed = 5.0 + 10.0 * hash01(0, row, 43);\r\n        var rowPhase = hash01(0, row, 53) * Math.PI * 2;\r\n        var rowWaves2 = 2 + Math.floor(hash01(0, row, 61) * 4);\r\n        var rowSpeed2 = rowSpeed * (rowWaves2 / rowWaves);\r\n        var rowPhase2 = hash01(0, row, 71) * Math.PI * 2;\r\n\r\n        var u1 = ((t * rowWaves * Math.PI * 2 + timeSec * rowSpeed + rowPhase) / (Math.PI * 2)) % 1;\r\n        if (u1 < 0) u1 += 1;\r\n        var u2 = ((t * rowWaves2 * Math.PI * 2 + timeSec * rowSpeed2 + rowPhase2) / (Math.PI * 2)) % 1;\r\n        if (u2 < 0) u2 += 1;\r\n\r\n        var p1 = Math.pow(1 - u1, 2.6 + 3.4 * hash01(col, row, 17));\r\n        var p2 = Math.pow(1 - u2, 3.4);\r\n        var pulse = Math.max(p1, p2 * (0.55 + 0.45 * hash01(col, row, 19))) * 0.85;\r\n\r\n        if (!dark) {\r\n          var lt = clamp01((t - 0.05) / 0.2);\r\n          if (lt <= 0) continue;\r\n          var lmap = getMergeMap(cols, rows);\r\n          var mi = row * cols + col;\r\n          var mv = lmap[mi];\r\n          if (mv === 2) continue;\r\n          if (hash01(col, row, 95) < 0.03) continue;\r\n          var wide = mv === 3 || mv === 1;\r\n          var tall = mv === 4 || mv === 1;\r\n          var y2 = row * cell;\r\n          var u = hash01(col, row, 93);\r\n          var sp = 22 + 66 * t;\r\n          var off = (u - 0.42) * sp;\r\n          if (off > 0) off *= 1.1;\r\n          var br = 187 - 32 * t;\r\n          var bg = 184 - 46 * t;\r\n          var bb = 206 + 4 * t;\r\n          var lr = br + off;\r\n          var lg = bg + (off < 0 ? off : off * 1.05);\r\n          var lb = bb + (off < 0 ? off : off * 0.65);\r\n          lr = Math.max(124, Math.min(240, Math.round(lr + 12 * pulse)));\r\n          lg = Math.max(100, Math.min(232, Math.round(lg + 12 * pulse)));\r\n          lb = Math.max(180, Math.min(252, Math.round(lb + 8 * pulse)));\r\n          var lw = cell * (wide ? 2 : 1) * 0.88;\r\n          var lh = cell * (tall ? 2 : 1) * 0.88;\r\n          var flicker = valueNoise(col, row, timeSec, 0.9, 83);\r\n          var density = clamp01((t - 0.12) / 0.35);\r\n          var threshold = 0.2 + 0.8 * density;\r\n          var presence = density > 0.9 ? 1 : clamp01((threshold - flicker) / 0.2);\r\n          if (presence <= 0.01) continue;\r\n          var lAlpha = clamp01(lt * appear * presence * (0.7 + 0.3 * (1 - flicker)) * (0.85 + 0.15 * hash01(col, row, 29)));\r\n          ctx.globalAlpha = lAlpha;\r\n          ctx.fillStyle = \"rgb(\" + lr + \",\" + lg + \",\" + lb + \")\";\r\n          fillRoundRect(ctx, x + 0.5, y2 + 0.5, lw, lh, 1);\r\n          // 流光脉冲是点阵“流动”的唯一来源：亮度不随强度衰减（中档只靠点更少、底色更淡、速度更慢来区分）\r\n          var whiteAmt = clamp01(pulse * (0.35 + 0.65 * t)) * (0.55 + 0.45 * hash01(col, row, 71));\r\n          if (progress < 0.999) {\r\n            var flash = clamp01(1 - (t - front) / 0.16) * (0.55 + 0.45 * hash01(col, row, 73));\r\n            whiteAmt = Math.max(whiteAmt, flash);\r\n          }\r\n          if (whiteAmt > 0.03) {\r\n            // 除回 alphaMul，让高光核心亮度与 High 一致\r\n            ctx.globalAlpha = Math.min(1, (lAlpha / alphaMul) * (0.12 + 0.88 * whiteAmt));\r\n            ctx.fillStyle = \"rgb(247, 243, 255)\";\r\n            var ins = lw * 0.14;\r\n            fillRoundRect(ctx, x + 0.5 + ins, y2 + 0.5 + ins, lw - ins * 2, lh - ins * 2, 0.7);\r\n          }\r\n          continue;\r\n        }\r\n\r\n        var flick = valueNoise(col, row, timeSec, 1.5, 5);\r\n        var gap = 0.6 + 0.4 * clamp01((flick - (1 - fade) * 0.5) / 0.3);\r\n        var vis = clamp01((t - 0.2) / 0.18);\r\n        var ghost = 0.06 * clamp01((flick - 0.5) / 0.5) * (1 - vis);\r\n        var baseAlpha = 0.04 + 0.96 * vis + ghost;\r\n        var gridAlpha = clamp01(base * baseAlpha * gap * appear * 1.15 * (0.9 + 0.1 * hash01(col, row, 29)));\r\n        if (gridAlpha < 0.008) continue;\r\n        var y = row * cell;\r\n        var size = cell * 0.72;\r\n        ctx.globalAlpha = Math.min(1, gridAlpha * 0.55);\r\n        ctx.fillStyle = \"rgb(\" + purple[0] + \",\" + purple[1] + \",\" + purple[2] + \")\";\r\n        fillRoundRect(ctx, x + 0.5, y + 0.5, size, size, 1.1);\r\n\r\n        // 同浅色模式：流光亮度不随强度衰减\r\n        var whiteAmtDark = clamp01(pulse * (0.35 + 0.65 * t)) * (0.55 + 0.45 * hash01(col, row, 71));\r\n        if (progress < 0.999) {\r\n          var flashDark = clamp01(1 - (t - front) / 0.16) * (0.55 + 0.45 * hash01(col, row, 73));\r\n          whiteAmtDark = Math.max(whiteAmtDark, flashDark);\r\n        }\r\n        if (whiteAmtDark > 0.03) {\r\n          ctx.globalAlpha = Math.min(1, (gridAlpha / alphaMul) * (0.1 + 0.72 * whiteAmtDark));\r\n          ctx.fillStyle = \"rgb(220, 204, 255)\";\r\n          fillRoundRect(ctx, x + 0.5, y + 0.5, size, size, 0.7);\r\n        }\r\n      }\r\n    }\r\n    ctx.globalAlpha = 1;\r\n  }\r\n\r\n  /**\r\n   * 根据档位列表自动推导能量起点与中点：\r\n   * - 若首档为 Off（如 4 档 Off / Low / High / Max），则第 1 档 (Low) 为纯蓝无星尘起点：\r\n   *   start = 1 / (count - 1), end = (start + 1) / 2\r\n   * - 若首档不是 Off（如 Antigravity 的 3 档 Low / Medium / High），则第 0 档 (Low) 为纯蓝起点：\r\n   *   start = 0, end = 0.5\r\n   */\r\n  function energyStopsFor(levels) {\r\n    var list = Array.isArray(levels) ? levels : [];\r\n    var n = list.length;\r\n    if (n <= 1) return { start: 0, end: 0.5, hasOffFirst: false };\r\n    var first = list[0];\r\n    var firstLabel = first && typeof first === \"object\" ? (first.effort || first.label || first.id || \"\") : String(first || \"\");\r\n    var hasOffFirst = isOffLevel(firstLabel);\r\n    var start = hasOffFirst ? 1 / (n - 1) : 0;\r\n    var end = (start + 1) / 2;\r\n    return { start: start, end: end, hasOffFirst: hasOffFirst };\r\n  }\r\n\r\n  function energyForPct(pct, startOverride) {\r\n    var p = clamp01(pct);\r\n    var start = typeof startOverride === \"number\" && Number.isFinite(startOverride) ? clamp01(startOverride) : ENERGY_START;\r\n    if (p <= start || start >= 1) return 0;\r\n    return clamp01((p - start) / (1 - start));\r\n  }\r\n\r\n  /**\r\n   * 位置 → 粒子横穿速率倍数：\r\n   * Medium (energy=0.5) 对应 1×（约 3.0s 横穿），High/Max (energy=1.0) 对应 2×（约 1.5s 横穿），左端下限 0.35×\r\n   */\r\n  function speedFor(pct, startOverride) {\r\n    var e = energyForPct(pct, startOverride);\r\n    return Math.min(MAX_SPEED_FACTOR, Math.max(0.35, 2 * e));\r\n  }\r\n\r\n  /**\r\n   * Claude 点阵特效强度（随位置连续变化，与 Codex 能量曲线同源）：\r\n   * energy=0 (Low) → 0 无特效；energy=0.5 (Medium) → ≈0.35 少量点阵；energy=1 (High) → 1 全量。\r\n   * 采用 e^1.5 曲线：低端起势柔和，靠近 High 时加速饱和。\r\n   */\r\n  function claudeIntensityFor(pct, startOverride) {\r\n    var e = energyForPct(pct, startOverride);\r\n    if (e <= 0) return 0;\r\n    return Math.round(Math.pow(e, 1.5) * 1000) / 1000;\r\n  }\r\n\r\n  /**\r\n   * Claude 点阵流动速度倍率（以 High = 1 为基准）：Medium = 0.5（慢一倍），下限 0.175。\r\n   * 直接复用 Codex 的 speedFor（Medium 1× / High 2×）再除以 2 归一化。\r\n   */\r\n  function claudeSpeedFor(pct, startOverride) {\r\n    return speedFor(pct, startOverride) / MAX_SPEED_FACTOR;\r\n  }\r\n\r\n  /** 位置 → 可见粒子数量（随能量从 0 渐增至 22 颗） */\r\n  function particleCountFor(pct, startOverride) {\r\n    return Math.round(energyForPct(pct, startOverride) * PARTICLES.length);\r\n  }\r\n\r\n  function starCountFor(pct, startOverride) {\r\n    return particleCountFor(pct, startOverride);\r\n  }\r\n\r\n  /**\r\n   * 第 index 颗粒子的亮度/大小系数（落在 [STARFIELD_MIN, 1]，越亮越大）：\r\n   * - 单参数调用 starBrightnessFor(indexOrStar)：返回该星固有亮度 [0.5, 1]\r\n   * - 双参数调用 starBrightnessFor(starOrIndex, energy)：当 energy 尚未达到该星出现序号时返回 0，已出现则返回固有亮度\r\n   */\r\n  function starBrightnessFor(starOrIndex, energy) {\r\n    var idx = typeof starOrIndex === \"number\"\r\n      ? starOrIndex\r\n      : (starOrIndex && typeof starOrIndex.id === \"number\" ? starOrIndex.id : 0);\r\n    var baseB = STARFIELD_MIN + (1 - STARFIELD_MIN) * starHash01(idx, 61);\r\n    if (energy === undefined) {\r\n      return Math.round(baseB * 1000) / 1000;\r\n    }\r\n    var e = clamp01(energy);\r\n    var visibleCount = Math.round(e * PARTICLES.length);\r\n    if (e <= 0 || idx >= visibleCount) return 0;\r\n    return Math.round(baseB * 1000) / 1000;\r\n  }\r\n\r\n  /**\r\n   * 第 index 颗粒子从右向左横穿轨道的时长（秒）：\r\n   * 最高档约 1.5s、中档约 3.0s、低端约 8.6s，各星之间仅差 ±8% 防止追尾成团\r\n   */\r\n  function starDurationFor(starOrIndex, speedFactor) {\r\n    var idx = typeof starOrIndex === \"number\"\r\n      ? starOrIndex\r\n      : (starOrIndex && typeof starOrIndex.id === \"number\" ? starOrIndex.id : 0);\r\n    var speed = Math.min(\r\n      MAX_SPEED_FACTOR,\r\n      Math.max(0.35, typeof speedFactor === \"number\" && Number.isFinite(speedFactor) ? speedFactor : MAX_SPEED_FACTOR)\r\n    );\r\n    var spread = 1 - STARFIELD_DURATION_SPREAD + 2 * STARFIELD_DURATION_SPREAD * starHash01(idx, 29);\r\n    return (STARFIELD_DURATION_MEAN * MAX_SPEED_FACTOR) / speed * spread;\r\n  }\r\n\r\n  /**\r\n   * 第 index 颗粒子的负相位延迟（秒）：\r\n   * 按黄金比低差异序列铺开，只与粒子序号与当前周期有关，与当前可见颗数无关\r\n   */\r\n  function starDelayFor(starOrIndex, duration) {\r\n    var idx = typeof starOrIndex === \"number\"\r\n      ? starOrIndex\r\n      : (starOrIndex && typeof starOrIndex.id === \"number\" ? starOrIndex.id : 0);\r\n    var particle = PARTICLES[idx];\r\n    var phase = particle && typeof particle.phase === \"number\" ? particle.phase : 0;\r\n    var dur = typeof duration === \"number\" && duration > 0 ? duration : starDurationFor(idx, MAX_SPEED_FACTOR);\r\n    var jitter = starHash01(idx, 53) * 0.03;\r\n    return -((phase + jitter) % 1) * dur;\r\n  }\r\n\r\n  /**\r\n   * 星星层总不透明度：独立于星云层，保证中档 (energy=0.5) 也有 0.8 的清晰度，最高档为 1.0\r\n   */\r\n  function starLayerOpacityFor(energyOrPct, startOverride) {\r\n    var e = typeof startOverride === \"number\" ? energyForPct(energyOrPct, startOverride) : clamp01(energyOrPct);\r\n    if (e <= 0) return 0;\r\n    return Math.round((0.6 + 0.4 * e) * 1000) / 1000;\r\n  }\r\n\r\n  function parseHexRgb(hex) {\r\n    var clean = String(hex || \"\").replace(/^#/, \"\");\r\n    var num = parseInt(clean, 16);\r\n    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];\r\n  }\r\n\r\n  function mixHex(hexA, hexB, t) {\r\n    var ratio = clamp01(t);\r\n    var a = parseHexRgb(hexA);\r\n    var b = parseHexRgb(hexB);\r\n    var r = Math.round(a[0] + (b[0] - a[0]) * ratio);\r\n    var g = Math.round(a[1] + (b[1] - a[1]) * ratio);\r\n    var bl = Math.round(a[2] + (b[2] - a[2]) * ratio);\r\n    return (\r\n      \"#\" +\r\n      ((1 << 24) | (r << 16) | (g << 8) | bl)\r\n        .toString(16)\r\n        .slice(1)\r\n    );\r\n  }\r\n\r\n  function hexToRgba(hex, alpha) {\r\n    var rgb = parseHexRgb(hex);\r\n    var a = typeof alpha === \"number\" && Number.isFinite(alpha) ? alpha : 1;\r\n    if (a < 0) a = 0;\r\n    if (a > 1) a = 1;\r\n    return \"rgba(\" + rgb[0] + \", \" + rgb[1] + \", \" + rgb[2] + \", \" + Math.round(a * 1000) / 1000 + \")\";\r\n  }\r\n\r\n  function applyRowRing(rowEl, hex, energy) {\r\n    if (!rowEl || !rowEl.style || typeof rowEl.style.setProperty !== \"function\") return;\r\n    if (!hex) {\r\n      rowEl.style.setProperty(\"--ces-ring\", \"transparent\");\r\n      rowEl.style.setProperty(\"--ces-ring-glow\", \"transparent\");\r\n      rowEl.style.setProperty(\"--ces-ring-blur\", \"0px\");\r\n      rowEl.style.setProperty(\"--ces-ring-spread\", \"0px\");\r\n      rowEl.style.setProperty(\"--ces-ring-fill\", \"transparent\");\r\n      rowEl.style.setProperty(\"--ces-ring-fill-hover\", \"rgba(128, 128, 145, 0.08)\");\r\n      return;\r\n    }\r\n    var e = clamp01(energy);\r\n    rowEl.style.setProperty(\"--ces-ring\", hexToRgba(hex, 0.42));\r\n    rowEl.style.setProperty(\"--ces-ring-glow\", hexToRgba(hex, 0.22 + 0.23 * e));\r\n    rowEl.style.setProperty(\"--ces-ring-blur\", (8 + 6 * e).toFixed(1) + \"px\");\r\n    rowEl.style.setProperty(\"--ces-ring-spread\", \"-4px\");\r\n    rowEl.style.setProperty(\"--ces-ring-fill\", hexToRgba(hex, 0.04 + 0.02 * e));\r\n    rowEl.style.setProperty(\"--ces-ring-fill-hover\", hexToRgba(hex, 0.08 + 0.03 * e));\r\n  }\r\n\r\n  /**\r\n   * 填充区末端主色：\r\n   * - pct <= start          : #4d93f8 (Codex 纯蓝)\r\n   * - start < pct <= end    : #4d93f8 -> #9333ea (蓝紫过渡)\r\n   * - end < pct <= 1        : #9333ea -> #4c1d95 (深紫星云)\r\n   */\r\n  function fillColorFor(pct, startOverride, endOverride, isClaude) {\r\n    var p = clamp01(pct);\r\n    var start = typeof startOverride === \"number\" && Number.isFinite(startOverride) ? startOverride : ENERGY_START;\r\n    var end = typeof endOverride === \"number\" && Number.isFinite(endOverride) ? endOverride : ENERGY_END;\r\n    if (isClaude) {\r\n      if (p <= start + 1e-6) return \"#71717a\";\r\n      if (p <= end + 1e-6) {\r\n        var cspan1 = Math.max(1e-6, end - start);\r\n        return mixHex(\"#71717a\", \"#a78bfa\", (p - start) / cspan1);\r\n      }\r\n      var cspan2 = Math.max(1e-6, 1 - end);\r\n      return mixHex(\"#a78bfa\", \"#704ea2\", (p - end) / cspan2);\r\n    }\r\n    if (p <= start + 1e-6) return \"#4d93f8\";\r\n    if (p <= end + 1e-6) {\r\n      var span1 = Math.max(1e-6, end - start);\r\n      return mixHex(\"#4d93f8\", \"#9333ea\", (p - start) / span1);\r\n    }\r\n    var span2 = Math.max(1e-6, 1 - end);\r\n    return mixHex(\"#9333ea\", \"#4c1d95\", (p - end) / span2);\r\n  }\r\n\r\n  /**\r\n   * 填充区线性渐变背景：\r\n   * 让轨道左侧始终保留蓝色起点，随滑块向右推进依次展开蓝紫过渡与深紫星云\r\n   */\r\n  function fillBackgroundFor(pct, startOverride, endOverride, isClaude) {\r\n    var p = clamp01(pct);\r\n    var start = typeof startOverride === \"number\" && Number.isFinite(startOverride) ? startOverride : ENERGY_START;\r\n    var end = typeof endOverride === \"number\" && Number.isFinite(endOverride) ? endOverride : ENERGY_END;\r\n    if (isClaude) {\r\n      if (p <= 0.05) return \"rgba(142, 118, 192, 0.15)\";\r\n      // 末端颜色随位置连续插值（#71717a → #a78bfa → #704ea2），避免过中点时整条填充色突变\r\n      return \"linear-gradient(90deg, rgba(142, 118, 192, 0.25) 0%, \" + fillColorFor(p, start, end, true) + \" 100%)\";\r\n    }\r\n    if (p <= start + 1e-6) return \"#4d93f8\";\r\n    var endColor = fillColorFor(p, start, end, false);\r\n    if (p <= end + 1e-6) {\r\n      var stopBlue = start > 0 ? Math.round((start / p) * 100) : 0;\r\n      if (stopBlue <= 0) {\r\n        return \"linear-gradient(90deg, #4d93f8 0%, \" + endColor + \" 100%)\";\r\n      }\r\n      return \"linear-gradient(90deg, #4d93f8 0%, #4d93f8 \" + stopBlue + \"%, \" + endColor + \" 100%)\";\r\n    }\r\n    var stopStart = start > 0 ? Math.round((start / p) * 100) : 0;\r\n    var stopMid = Math.round((end / p) * 100);\r\n    if (stopStart <= 0) {\r\n      return \"linear-gradient(90deg, #4d93f8 0%, #9333ea \" + stopMid + \"%, \" + endColor + \" 100%)\";\r\n    }\r\n    return (\r\n      \"linear-gradient(90deg, #4d93f8 0%, #4d93f8 \" +\r\n      stopStart +\r\n      \"%, #9333ea \" +\r\n      stopMid +\r\n      \"%, \" +\r\n      endColor +\r\n      \" 100%)\"\r\n    );\r\n  }\r\n\r\n  /**\r\n   * 档位文字着色：\r\n   * - 单档位锁定模型或 Off 档位保持官方默认灰（返回 \"\"）\r\n   * - Codex 风格：首档蓝 #4d93f8、中档蓝紫 #6c78f7、高档亮紫 #8b5cf6\r\n   * - Claude 风格：首档暖灰/柔紫 #94a3b8、中档紫罗兰 #a78bfa、高档亮淡紫 #c4b5fd\r\n   */\r\n  function valueColorFor(label, index, count, isMax, hasOffFirst, isClaude) {\r\n    if (isOffLevel(label)) return \"\";\r\n    var n = Number(count) || 0;\r\n    if (n <= 1) return \"\";\r\n    if (isClaude) {\r\n      if (isMax || index === n - 1) return \"#c4b5fd\";\r\n      var cIdx = typeof index === \"number\" && index >= 0 ? index : 0;\r\n      var cFirstActive = hasOffFirst ? 1 : 0;\r\n      if (cIdx <= cFirstActive) return \"#94a3b8\";\r\n      if (n === 3 && cIdx === 1) return \"#a78bfa\";\r\n      var cDenom = Math.max(1, n - 1 - cFirstActive);\r\n      var cT = clamp01((cIdx - cFirstActive) / cDenom);\r\n      return mixHex(\"#94a3b8\", \"#c4b5fd\", cT);\r\n    }\r\n    if (isMax || index === n - 1) return \"#8b5cf6\";\r\n    var idx = typeof index === \"number\" && index >= 0 ? index : 0;\r\n    var firstActive = hasOffFirst ? 1 : 0;\r\n    if (idx <= firstActive) return \"#4d93f8\";\r\n    var denom = Math.max(1, n - 1 - firstActive);\r\n    var t = clamp01((idx - firstActive) / denom);\r\n    return mixHex(\"#4d93f8\", \"#8b5cf6\", t);\r\n  }\r\n\r\n  var FILL_RADIUS_CSS = KNOB_RADIUS + \"px 0 0 \" + KNOB_RADIUS + \"px\";\r\n\r\n  // ── 样式表注入（对齐 dsh-codex-effort-slider 右向左星尘横穿 + 星云扫光 + Antigravity 面板适配） ──\r\n  var SLIDER_CSS = [\r\n    \"@keyframes ces-sweep {\",\r\n    \"  0% { transform: translateX(100%); }\",\r\n    \"  100% { transform: translateX(-100%); }\",\r\n    \"}\",\r\n    \"@keyframes ces-star-sweep {\",\r\n    \"  0% { transform: translate3d(0, 0, 0); opacity: 0; }\",\r\n    \"  6% { opacity: 1; }\",\r\n    \"  94% { opacity: 1; }\",\r\n    \"  100% { transform: translate3d(-100%, 0, 0); opacity: 0; }\",\r\n    \"}\",\r\n    \".ces-inline {\",\r\n    \"  width: 100%;\",\r\n    \"  box-sizing: border-box;\",\r\n    \"  padding-top: 6px;\",\r\n    \"  user-select: none !important;\",\r\n    \"  -webkit-user-select: none !important;\",\r\n    \"}\",\r\n    \".ces-root,\",\r\n    \".ces-root:focus,\",\r\n    \".ces-root:focus-visible,\",\r\n    \".ces-root:focus-within {\",\r\n    \"  position: relative;\",\r\n    \"  width: 100%;\",\r\n    \"  box-sizing: border-box;\",\r\n    \"  outline: none !important;\",\r\n    \"  outline-width: 0 !important;\",\r\n    \"  box-shadow: none !important;\",\r\n    \"  user-select: none !important;\",\r\n    \"  -webkit-user-select: none !important;\",\r\n    \"  -webkit-tap-highlight-color: transparent !important;\",\r\n    \"}\",\r\n    \".ces-track {\",\r\n    \"  position: relative;\",\r\n    \"  width: 100%;\",\r\n    \"  height: \" + TRACK_HEIGHT + \"px;\",\r\n    \"  border-radius: 999px;\",\r\n    \"  background: rgba(128, 128, 145, 0.18);\",\r\n    \"  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.24), inset 0 0 0 1px rgba(255, 255, 255, 0.06);\",\r\n    \"  cursor: pointer;\",\r\n    \"  touch-action: none;\",\r\n    \"  box-sizing: border-box;\",\r\n    \"  transition: opacity 0.15s ease, box-shadow 0.2s ease;\",\r\n    \"}\",\r\n    \".ces-inline[data-energy='1'] .ces-track,\",\r\n    \".ces-root[data-energy='1'] .ces-track {\",\r\n    \"  box-shadow: 0 0 calc(var(--ces-energy, 0) * 16px) rgba(168, 85, 247, 0.5), inset 0 1px 2px rgba(0, 0, 0, 0.24);\",\r\n    \"}\",\r\n    \".ces-inline[data-energy='0'] .ces-star,\",\r\n    \".ces-inline[data-energy='0'] .ces-energy__sweep,\",\r\n    \".ces-root[data-energy='0'] .ces-star,\",\r\n    \".ces-root[data-energy='0'] .ces-energy__sweep {\",\r\n    \"  animation-play-state: paused;\",\r\n    \"}\",\r\n    \".ces-track.is-locked {\",\r\n    \"  opacity: 0.45;\",\r\n    \"  cursor: not-allowed;\",\r\n    \"  filter: saturate(0.25);\",\r\n    \"}\",\r\n    \".ces-fill {\",\r\n    \"  position: absolute;\",\r\n    \"  top: 0;\",\r\n    \"  left: 0;\",\r\n    \"  bottom: 0;\",\r\n    \"  width: var(--ces-fill, 14px);\",\r\n    \"  border-radius: \" + FILL_RADIUS_CSS + \";\",\r\n    \"  background: var(--ces-fill-bg, #4d93f8);\",\r\n    \"  pointer-events: none;\",\r\n    \"  will-change: width, background;\",\r\n    \"}\",\r\n    \".ces-energy {\",\r\n    \"  position: absolute;\",\r\n    \"  top: 0;\",\r\n    \"  left: 0;\",\r\n    \"  bottom: 0;\",\r\n    \"  width: var(--ces-fill, 14px);\",\r\n    \"  border-radius: \" + FILL_RADIUS_CSS + \";\",\r\n    \"  overflow: hidden;\",\r\n    \"  pointer-events: none;\",\r\n    \"  opacity: var(--ces-energy, 0);\",\r\n    \"  transition: opacity 0.2s ease;\",\r\n    \"  background: linear-gradient(90deg, #3b1178 0%, #6d28d9 30%, #9333ea 62%, #c084fc 100%);\",\r\n    \"}\",\r\n    \".ces-energy__sweep {\",\r\n    \"  position: absolute;\",\r\n    \"  inset: 0;\",\r\n    \"  background: linear-gradient(100deg, transparent 18%, rgba(255, 255, 255, 0.30) 50%, transparent 82%);\",\r\n    \"  transform: translateX(100%);\",\r\n    \"  animation: ces-sweep 2.4s linear infinite;\",\r\n    \"  pointer-events: none;\",\r\n    \"}\",\r\n    \".ces-stars {\",\r\n    \"  position: absolute;\",\r\n    \"  top: 0;\",\r\n    \"  left: 0;\",\r\n    \"  bottom: 0;\",\r\n    \"  width: var(--ces-fill, 14px);\",\r\n    \"  border-radius: \" + FILL_RADIUS_CSS + \";\",\r\n    \"  opacity: var(--ces-star-opacity, 0);\",\r\n    \"  transition: opacity 0.2s ease;\",\r\n    \"  pointer-events: none;\",\r\n    \"  overflow: hidden;\",\r\n    \"}\",\r\n    \".ces-star {\",\r\n    \"  position: absolute;\",\r\n    \"  left: 0;\",\r\n    \"  right: 0;\",\r\n    \"  height: 3px;\",\r\n    \"  margin-top: -1.5px;\",\r\n    \"  pointer-events: none;\",\r\n    \"  animation-name: ces-star-sweep;\",\r\n    \"  animation-timing-function: linear;\",\r\n    \"  animation-iteration-count: infinite;\",\r\n    \"}\",\r\n    \".ces-star__dot {\",\r\n    \"  position: absolute;\",\r\n    \"  left: 100%;\",\r\n    \"  top: 0;\",\r\n    \"  width: 3px;\",\r\n    \"  height: 3px;\",\r\n    \"  margin-left: -1.5px;\",\r\n    \"  border-radius: 50%;\",\r\n    \"  background: #f5f3ff;\",\r\n    \"  box-shadow: 0 0 5px rgba(216, 180, 254, 0.95);\",\r\n    \"  opacity: var(--ces-b, 1);\",\r\n    \"  transform: scale(var(--ces-b, 1));\",\r\n    \"}\",\r\n    \".ces-ticks {\",\r\n    \"  position: absolute;\",\r\n    \"  inset: 0;\",\r\n    \"  pointer-events: none;\",\r\n    \"}\",\r\n    \".ces-tick {\",\r\n    \"  position: absolute;\",\r\n    \"  top: 50%;\",\r\n    \"  width: 3px;\",\r\n    \"  height: 3px;\",\r\n    \"  margin: -1.5px 0 0 -1.5px;\",\r\n    \"  border-radius: 50%;\",\r\n    \"  background: rgba(255, 255, 255, 0.28);\",\r\n    \"  pointer-events: none;\",\r\n    \"  transition: background-color 0.12s ease;\",\r\n    \"}\",\r\n    \".ces-tick.is-on {\",\r\n    \"  background: rgba(255, 255, 255, 0.65);\",\r\n    \"}\",\r\n    \".ces-tick.is-dim {\",\r\n    \"  background: rgba(255, 255, 255, 0.28);\",\r\n    \"}\",\r\n    \".ces-knob {\",\r\n    \"  position: absolute;\",\r\n    \"  top: 50%;\",\r\n    \"  left: var(--ces-fill, 14px);\",\r\n    \"  width: \" + KNOB_SIZE + \"px;\",\r\n    \"  height: \" + KNOB_SIZE + \"px;\",\r\n    \"  margin: \" + (-KNOB_RADIUS) + \"px 0 0 \" + (-KNOB_RADIUS) + \"px;\",\r\n    \"  border-radius: 50%;\",\r\n    \"  background: #ffffff;\",\r\n    \"  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.34), 0 0 0 0.5px rgba(0, 0, 0, 0.06);\",\r\n    \"  pointer-events: none;\",\r\n    \"  will-change: left;\",\r\n    \"}\",\r\n    \"/* ── Claude 专属主题适配 (data-theme='claude') ── */\",\r\n    \".ces-root[data-theme='claude'] .ces-stars,\",\r\n    \".ces-root[data-theme='claude'] .ces-energy,\",\r\n    \".ces-inline[data-theme='claude'] .ces-stars,\",\r\n    \".ces-inline[data-theme='claude'] .ces-energy {\",\r\n    \"  display: none !important;\",\r\n    \"}\",\r\n    \".ces-root[data-theme='claude'] .ces-track,\",\r\n    \".ces-inline[data-theme='claude'] .ces-track {\",\r\n    \"  height: 28px;\",\r\n    \"  border-radius: 999px;\",\r\n    \"  background: rgba(128, 128, 145, 0.16);\",\r\n    \"  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.22), inset 0 0 0 1px rgba(255, 255, 255, 0.08);\",\r\n    \"}\",\r\n    \".ces-root[data-theme='claude'][data-energy='1'] .ces-track,\",\r\n    \".ces-inline[data-theme='claude'][data-energy='1'] .ces-track {\",\r\n    \"  box-shadow: 0 0 16px rgba(167, 139, 250, 0.45), inset 0 1px 2px rgba(0, 0, 0, 0.22);\",\r\n    \"}\",\r\n    \".ces-root[data-theme='claude'] .ces-knob,\",\r\n    \".ces-inline[data-theme='claude'] .ces-knob {\",\r\n    \"  width: 24px;\",\r\n    \"  height: 30px;\",\r\n    \"  margin: -15px 0 0 -12px;\",\r\n    \"  border-radius: 7px;\",\r\n    \"  background: #ffffff;\",\r\n    \"  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4), 0 0 0 0.5px rgba(0, 0, 0, 0.12);\",\r\n    \"  display: flex;\",\r\n    \"  align-items: center;\",\r\n    \"  justify-content: center;\",\r\n    \"}\",\r\n    \".ces-knob-notch {\",\r\n    \"  display: none;\",\r\n    \"  width: 2px;\",\r\n    \"  height: 10px;\",\r\n    \"  border-radius: 999px;\",\r\n    \"  background: rgba(0, 0, 0, 0.28);\",\r\n    \"}\",\r\n    \".ces-root[data-theme='claude'] .ces-knob-notch,\",\r\n    \".ces-inline[data-theme='claude'] .ces-knob-notch {\",\r\n    \"  display: block;\",\r\n    \"}\",\r\n    \".ces-claude-canvas {\",\r\n    \"  position: absolute;\",\r\n    \"  left: 0;\",\r\n    \"  top: 0;\",\r\n    // 宽度由 JS 每帧同步为已填充宽度（与 .ces-stars 一致），只在圆钮左侧绘制点阵，杜绝右侧未填充区提前冒出特效\r\n    \"  width: var(--ces-fill, 0px);\",\r\n    \"  height: 100%;\",\r\n    \"  border-radius: 999px;\",\r\n    \"  display: none;\",\r\n    \"  pointer-events: none;\",\r\n    \"}\",\r\n    \".ces-root[data-theme='claude'][data-energy='1'] .ces-claude-canvas,\",\r\n    \".ces-inline[data-theme='claude'][data-energy='1'] .ces-claude-canvas {\",\r\n    \"  display: block;\",\r\n    \"}\",\r\n    \"@keyframes ces-claude-rise {\",\r\n    \"  0% { transform: translateY(85%) scale(0.96); opacity: 0; }\",\r\n    \"  55% { opacity: 1; }\",\r\n    \"  80% { transform: translateY(-6%) scale(1.01); }\",\r\n    \"  100% { transform: translateY(0) scale(1); opacity: 1; }\",\r\n    \"}\",\r\n    \".ces-ag-effort-value.is-claude-changing,\",\r\n    \".ces-ag-effort-value.ces-text-rise {\",\r\n    \"  animation: ces-claude-rise 0.3s cubic-bezier(0.2, 0.85, 0.25, 1);\",\r\n    \"}\",\r\n    \"/* 当同时触发文字向上翻转与 High 光斑爆散时，以 CSS 复合动画并发执行，防止相互覆盖打断 */\",\r\n    \".ces-ag-effort-value.is-claude-changing.is-glowing,\",\r\n    \".ces-ag-effort-value.ces-text-rise.is-glowing {\",\r\n    \"  animation: ces-claude-rise 0.3s cubic-bezier(0.2, 0.85, 0.25, 1), ces-text-bloom 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;\",\r\n    \"}\",\r\n    \"/* Antigravity 原生模型菜单底部专属「推理等级」区域 */\",\r\n    \"[data-testid='model-selector-panel'].ces-ag-panel-enhanced {\",\r\n    \"  max-height: 26rem !important;\",\r\n    \"}\",\r\n    \".ces-ag-section,\",\r\n    \".ces-ag-section:focus,\",\r\n    \".ces-ag-section:focus-visible,\",\r\n    \".ces-ag-section * {\",\r\n    \"  outline: none !important;\",\r\n    \"  outline-width: 0 !important;\",\r\n    \"  user-select: none !important;\",\r\n    \"  -webkit-user-select: none !important;\",\r\n    \"  -webkit-tap-highlight-color: transparent !important;\",\r\n    \"}\",\r\n    \".ces-ag-section {\",\r\n    \"  display: flex;\",\r\n    \"  flex-direction: column;\",\r\n    \"  flex-shrink: 0;\",\r\n    \"  width: 100%;\",\r\n    \"  box-sizing: border-box;\",\r\n    \"}\",\r\n    \"/* 对话输入框右侧、权限下拉左侧的紧凑常驻滑条 */\",\r\n    \".ces-ag-composer {\",\r\n    \"  display: inline-flex;\",\r\n    \"  flex-direction: row;\",\r\n    \"  align-items: center;\",\r\n    \"  flex-shrink: 0;\",\r\n    \"  width: auto;\",\r\n    \"  max-width: 176px;\",\r\n    \"  height: 28px;\",\r\n    \"  margin-right: 4px;\",\r\n    \"  box-sizing: border-box;\",\r\n    \"  pointer-events: auto;\",\r\n    \"}\",\r\n    \".ces-ag-composer .ces-ag-effort-row {\",\r\n    \"  flex-direction: row;\",\r\n    \"  align-items: center;\",\r\n    \"  gap: 6px;\",\r\n    \"  width: auto;\",\r\n    \"  height: 28px;\",\r\n    \"  padding: 0 4px 0 6px;\",\r\n    \"  border-radius: 999px;\",\r\n    \"}\",\r\n    \".ces-ag-composer .ces-ag-effort-row:hover {\",\r\n    \"  background-color: var(--ces-ring-fill-hover, rgba(128, 128, 145, 0.10));\",\r\n    \"}\",\r\n    \".ces-ag-composer .ces-ag-effort-head {\",\r\n    \"  width: auto;\",\r\n    \"  flex-shrink: 0;\",\r\n    \"}\",\r\n    \".ces-ag-composer .ces-ag-effort-title {\",\r\n    \"  display: none;\",\r\n    \"}\",\r\n    \".ces-ag-composer .ces-ag-effort-value {\",\r\n    \"  font-size: 11px;\",\r\n    \"  line-height: 16px;\",\r\n    \"  min-width: 2.75em;\",\r\n    \"  text-align: right;\",\r\n    \"}\",\r\n    \".ces-ag-composer .ces-inline {\",\r\n    \"  width: 112px;\",\r\n    \"  min-width: 88px;\",\r\n    \"  padding-top: 0;\",\r\n    \"  flex: 1 1 auto;\",\r\n    \"}\",\r\n    \".ces-ag-composer .ces-root,\",\r\n    \".ces-ag-composer .ces-track {\",\r\n    \"  height: 16px;\",\r\n    \"}\",\r\n    \".ces-ag-composer .ces-knob {\",\r\n    \"  width: 16px;\",\r\n    \"  height: 16px;\",\r\n    \"  margin: -8px 0 0 -8px;\",\r\n    \"}\",\r\n    \".ces-ag-composer .ces-root[data-theme='claude'] .ces-track,\",\r\n    \".ces-ag-composer .ces-inline[data-theme='claude'] .ces-track {\",\r\n    \"  height: 16px;\",\r\n    \"}\",\r\n    \".ces-ag-composer .ces-root[data-theme='claude'] .ces-knob,\",\r\n    \".ces-ag-composer .ces-inline[data-theme='claude'] .ces-knob {\",\r\n    \"  width: 14px;\",\r\n    \"  height: 18px;\",\r\n    \"  margin: -9px 0 0 -7px;\",\r\n    \"  border-radius: 5px;\",\r\n    \"}\",\r\n    \".ces-ag-composer .ces-knob-notch {\",\r\n    \"  height: 8px;\",\r\n    \"}\",\r\n    \"@container input-footer (max-width: 420px) {\",\r\n    \"  .ces-ag-composer { max-width: 128px; }\",\r\n    \"  .ces-ag-composer .ces-ag-effort-value { display: none; }\",\r\n    \"  .ces-ag-composer .ces-inline { width: 96px; min-width: 72px; }\",\r\n    \"}\",\r\n    \".ces-ag-effort-row {\",\r\n    \"  display: flex;\",\r\n    \"  flex-direction: column;\",\r\n    \"  width: 100%;\",\r\n    \"  box-sizing: border-box;\",\r\n    \"  padding: 6px 8px 8px 8px;\",\r\n    \"  border-radius: 6px;\",\r\n    \"  box-shadow: inset 0 0 0 1px var(--ces-ring, transparent), 0 0 var(--ces-ring-blur, 0px) var(--ces-ring-spread, 0px) var(--ces-ring-glow, transparent);\",\r\n    \"  background-color: var(--ces-ring-fill, transparent);\",\r\n    \"  transition: box-shadow 0.2s ease, background-color 0.2s ease;\",\r\n    \"}\",\r\n    \".ces-ag-effort-row:hover {\",\r\n    \"  background-color: var(--ces-ring-fill-hover, rgba(128, 128, 145, 0.08));\",\r\n    \"}\",\r\n    \".ces-ag-effort-head {\",\r\n    \"  display: flex;\",\r\n    \"  align-items: center;\",\r\n    \"  justify-content: space-between;\",\r\n    \"  width: 100%;\",\r\n    \"  font-size: 12px;\",\r\n    \"  line-height: 16px;\",\r\n    \"}\",\r\n    \".ces-ag-effort-title {\",\r\n    \"  display: inline-flex;\",\r\n    \"  align-items: center;\",\r\n    \"  gap: 6px;\",\r\n    \"  color: inherit;\",\r\n    \"  font-weight: 500;\",\r\n    \"  opacity: 0.9;\",\r\n    \"}\",\r\n    \"/* ── 'High' 档位文字到达最高档时的模糊光斑爆散 (约 0.4s 淡淡消失) ── */\",\r\n    \".ces-ag-effort-value {\",\r\n    \"  position: relative;\",\r\n    \"  z-index: 1;\",\r\n    \"  display: inline-block;\",\r\n    \"  font-size: 12px;\",\r\n    \"  font-weight: 600;\",\r\n    \"  transition: color 0.15s ease;\",\r\n    \"}\",\r\n    \".ces-ag-effort-value::after {\",\r\n    \"  content: '';\",\r\n    \"  position: absolute;\",\r\n    \"  top: 50%;\",\r\n    \"  left: 50%;\",\r\n    \"  width: 52px;\",\r\n    \"  height: 26px;\",\r\n    \"  border-radius: 999px;\",\r\n    \"  transform: translate(-50%, -50%) scale(0.6);\",\r\n    \"  background: radial-gradient(ellipse at center, var(--ces-glow-color, rgba(168, 85, 247, 0.85)) 0%, var(--ces-glow-color, rgba(168, 85, 247, 0.45)) 45%, rgba(168, 85, 247, 0) 75%);\",\r\n    \"  filter: blur(8px);\",\r\n    \"  pointer-events: none;\",\r\n    \"  opacity: 0;\",\r\n    \"  z-index: -1;\",\r\n    \"}\",\r\n    \"@keyframes ces-glow-flash {\",\r\n    \"  0% {\",\r\n    \"    opacity: 0.95;\",\r\n    \"    transform: translate(-50%, -50%) scale(0.65);\",\r\n    \"    filter: blur(6px);\",\r\n    \"  }\",\r\n    \"  25% {\",\r\n    \"    opacity: 1;\",\r\n    \"    transform: translate(-50%, -50%) scale(1.15);\",\r\n    \"    filter: blur(8px);\",\r\n    \"  }\",\r\n    \"  100% {\",\r\n    \"    opacity: 0;\",\r\n    \"    transform: translate(-50%, -50%) scale(1.5);\",\r\n    \"    filter: blur(14px);\",\r\n    \"  }\",\r\n    \"}\",\r\n    \"@keyframes ces-text-bloom {\",\r\n    \"  0% { text-shadow: 0 0 8px var(--ces-glow-color, #c084fc); }\",\r\n    \"  30% { text-shadow: 0 0 14px var(--ces-glow-color, #c084fc), 0 0 3px #ffffff; }\",\r\n    \"  100% { text-shadow: none; }\",\r\n    \"}\",\r\n    \".ces-ag-effort-value.is-glowing {\",\r\n    \"  animation: ces-text-bloom 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;\",\r\n    \"}\",\r\n    \".ces-ag-effort-value.is-glowing::after {\",\r\n    \"  animation: ces-glow-flash 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;\",\r\n    \"}\",\r\n    \"@media (prefers-reduced-motion: reduce) {\",\r\n    \"  .ces-panel-shaking { animation: none !important; }\",\r\n    \"  .ces-ag-effort-value.is-glowing { animation: none !important; }\",\r\n    \"  .ces-ag-effort-value.is-glowing::after { animation: none !important; }\",\r\n    \"  .ces-ag-effort-value.ces-text-rise { animation: none !important; }\",\r\n    \"  .ces-ag-effort-value.is-claude-changing { animation: none !important; }\",\r\n    \"}\",\r\n    \"/* 屏蔽模型行悬停弹出的冗余右侧二级档位子菜单（严格排除包含 model-selector-panel 的外层主菜单容器，防止悬停时主面板闪烁） */\",\r\n    \"[role='menu']:has([data-testid='model-selector-effort-option']):not(:has([data-testid='model-selector-panel'])),\",\r\n    \"div[role='presentation']:has(> [role='menu'] [data-testid='model-selector-effort-option']):not(:has([data-testid='model-selector-panel'])) {\",\r\n    \"  display: none !important;\",\r\n    \"  visibility: hidden !important;\",\r\n    \"  pointer-events: none !important;\",\r\n    \"  opacity: 0 !important;\",\r\n    \"}\",\r\n    \"[role='menuitem']:has([data-testid='model-selector-effort-group']) > span.shrink-0:last-child {\",\r\n    \"  display: none !important;\",\r\n    \"}\",\r\n    \"[role='menuitem']:has([data-testid='model-selector-effort-group']) > .group-hover\\\\:hidden {\",\r\n    \"  display: flex !important;\",\r\n    \"}\",\r\n    \"[role='menuitem'][data-ces-model-selected='true'] {\",\r\n    \"  background-color: rgba(128, 128, 145, 0.14);\",\r\n    \"}\",\r\n    \"/* 右键 / 长按 设置浮层 */\",\r\n    \".ces-set {\",\r\n    \"  position: fixed;\",\r\n    \"  z-index: 2147483646;\",\r\n    \"  width: 268px;\",\r\n    \"  padding: 12px;\",\r\n    \"  border-radius: 10px;\",\r\n    \"  background: rgba(24, 24, 28, 0.96);\",\r\n    \"  color: #f4f4f6;\",\r\n    \"  border: 1px solid rgba(255, 255, 255, 0.12);\",\r\n    \"  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);\",\r\n    \"  backdrop-filter: blur(12px);\",\r\n    \"  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;\",\r\n    \"  font-size: 12px;\",\r\n    \"  box-sizing: border-box;\",\r\n    \"  user-select: none;\",\r\n    \"}\",\r\n    \".ces-set-head {\",\r\n    \"  display: flex;\",\r\n    \"  align-items: center;\",\r\n    \"  justify-content: space-between;\",\r\n    \"  margin-bottom: 10px;\",\r\n    \"  padding-bottom: 6px;\",\r\n    \"  border-bottom: 1px solid rgba(255, 255, 255, 0.08);\",\r\n    \"  font-weight: 600;\",\r\n    \"  font-size: 12.5px;\",\r\n    \"}\",\r\n    \".ces-set-ver {\",\r\n    \"  font-size: 11px;\",\r\n    \"  font-weight: 400;\",\r\n    \"  opacity: 0.55;\",\r\n    \"}\",\r\n    \".ces-set-group {\",\r\n    \"  margin-bottom: 10px;\",\r\n    \"}\",\r\n    \".ces-set-label {\",\r\n    \"  margin-bottom: 5px;\",\r\n    \"  font-size: 11px;\",\r\n    \"  opacity: 0.72;\",\r\n    \"}\",\r\n    \".ces-set-opts {\",\r\n    \"  display: flex;\",\r\n    \"  gap: 4px;\",\r\n    \"}\",\r\n    \".ces-set-opt {\",\r\n    \"  flex: 1;\",\r\n    \"  padding: 5px 6px;\",\r\n    \"  border-radius: 6px;\",\r\n    \"  border: 1px solid rgba(255, 255, 255, 0.1);\",\r\n    \"  background: rgba(255, 255, 255, 0.04);\",\r\n    \"  color: #d4d4d8;\",\r\n    \"  font-size: 11.5px;\",\r\n    \"  cursor: pointer;\",\r\n    \"  text-align: center;\",\r\n    \"  transition: all 0.12s ease;\",\r\n    \"}\",\r\n    \".ces-set-opt:hover {\",\r\n    \"  background: rgba(255, 255, 255, 0.1);\",\r\n    \"  color: #ffffff;\",\r\n    \"}\",\r\n    \".ces-set-opt.is-on {\",\r\n    \"  background: rgba(139, 92, 246, 0.28);\",\r\n    \"  border-color: rgba(139, 92, 246, 0.75);\",\r\n    \"  color: #ffffff;\",\r\n    \"  font-weight: 600;\",\r\n    \"}\",\r\n    \".ces-set-actions {\",\r\n    \"  display: flex;\",\r\n    \"  gap: 6px;\",\r\n    \"  margin-top: 8px;\",\r\n    \"  padding-top: 8px;\",\r\n    \"  border-top: 1px solid rgba(255, 255, 255, 0.08);\",\r\n    \"}\",\r\n    \".ces-set-btn {\",\r\n    \"  flex: 1;\",\r\n    \"  padding: 5px 8px;\",\r\n    \"  border-radius: 6px;\",\r\n    \"  border: 1px solid rgba(255, 255, 255, 0.12);\",\r\n    \"  background: rgba(255, 255, 255, 0.06);\",\r\n    \"  color: #e4e4e7;\",\r\n    \"  font-size: 11px;\",\r\n    \"  cursor: pointer;\",\r\n    \"}\",\r\n    \".ces-set-btn:hover {\",\r\n    \"  background: rgba(255, 255, 255, 0.14);\",\r\n    \"}\"\r\n  ].join(\"\\n\");\r\n\r\n  function installStyles(doc) {\r\n    var d = doc || (typeof document !== \"undefined\" ? document : null);\r\n    if (!d || !d.head) return null;\r\n    var existing = d.getElementById(STYLE_ELEMENT_ID);\r\n    if (existing) {\r\n      if (existing.textContent !== SLIDER_CSS) {\r\n        existing.textContent = SLIDER_CSS;\r\n      }\r\n      return existing;\r\n    }\r\n    var style = d.createElement(\"style\");\r\n    style.id = STYLE_ELEMENT_ID;\r\n    style.textContent = SLIDER_CSS;\r\n    d.head.appendChild(style);\r\n    return style;\r\n  }\r\n\r\n  // ── 右键设置面板 ────────────────────────────────────────────────────────────\r\n  function openSettingsPanel(options) {\r\n    var opts = options || {};\r\n    var doc = opts.document || (typeof document !== \"undefined\" ? document : null);\r\n    var win = opts.window || (doc && doc.defaultView) || (typeof window !== \"undefined\" ? window : globalRoot);\r\n    if (!doc || !doc.body) return function () {};\r\n    installStyles(doc);\r\n\r\n    var prev = doc.querySelector(\".ces-set\");\r\n    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);\r\n\r\n    var panel = doc.createElement(\"div\");\r\n    panel.className = \"ces-set\";\r\n    panel.setAttribute(\"role\", \"dialog\");\r\n    panel.setAttribute(\"aria-label\", \"推理等级滑条设置\");\r\n\r\n    var x = typeof opts.x === \"number\" ? opts.x : 120;\r\n    var y = typeof opts.y === \"number\" ? opts.y : 120;\r\n    var vw = (win && win.innerWidth) || 800;\r\n    var vh = (win && win.innerHeight) || 600;\r\n    var clampedLeft = Math.max(8, Math.min(vw - 276, x));\r\n    var clampedTop = Math.max(8, Math.min(vh - 230, y));\r\n    panel.style.left = clampedLeft + \"px\";\r\n    panel.style.top = clampedTop + \"px\";\r\n\r\n    var head = doc.createElement(\"div\");\r\n    head.className = \"ces-set-head\";\r\n    var titleSpan = doc.createElement(\"span\");\r\n    titleSpan.textContent = \"推理等级滑条\";\r\n    var verSpan = doc.createElement(\"span\");\r\n    verSpan.className = \"ces-set-ver\";\r\n    verSpan.textContent = \"v1.2.1\";\r\n    head.appendChild(titleSpan);\r\n    head.appendChild(verSpan);\r\n    panel.appendChild(head);\r\n\r\n    var optButtons = [];\r\n    function refreshActiveButtons() {\r\n      var cur = readSettings(win);\r\n      for (var i = 0; i < optButtons.length; i += 1) {\r\n        var item = optButtons[i];\r\n        var isOn = cur[item.key] === item.value;\r\n        if (isOn) item.btn.classList.add(\"is-on\");\r\n        else item.btn.classList.remove(\"is-on\");\r\n        item.btn.setAttribute(\"aria-pressed\", isOn ? \"true\" : \"false\");\r\n      }\r\n    }\r\n\r\n    for (var sIdx = 0; sIdx < SETTINGS_SCHEMA.length; sIdx += 1) {\r\n      (function (schemaItem) {\r\n        var group = doc.createElement(\"div\");\r\n        group.className = \"ces-set-group\";\r\n        var label = doc.createElement(\"div\");\r\n        label.className = \"ces-set-label\";\r\n        label.textContent = schemaItem.label;\r\n        group.appendChild(label);\r\n\r\n        var row = doc.createElement(\"div\");\r\n        row.className = \"ces-set-opts\";\r\n        for (var oIdx = 0; oIdx < schemaItem.options.length; oIdx += 1) {\r\n          (function (optionItem) {\r\n            var btn = doc.createElement(\"button\");\r\n            btn.type = \"button\";\r\n            btn.className = \"ces-set-opt\";\r\n            btn.textContent = optionItem.label;\r\n            if (optionItem.hint) btn.title = optionItem.hint;\r\n            btn.addEventListener(\"click\", function (ev) {\r\n              ev.stopPropagation();\r\n              var patch = {};\r\n              patch[schemaItem.key] = optionItem.value;\r\n              writeSettings(patch, win);\r\n              refreshActiveButtons();\r\n            });\r\n            optButtons.push({ key: schemaItem.key, value: optionItem.value, btn: btn });\r\n            row.appendChild(btn);\r\n          })(schemaItem.options[oIdx]);\r\n        }\r\n        group.appendChild(row);\r\n        panel.appendChild(group);\r\n      })(SETTINGS_SCHEMA[sIdx]);\r\n    }\r\n\r\n    var actions = doc.createElement(\"div\");\r\n    actions.className = \"ces-set-actions\";\r\n\r\n    var copyBtn = doc.createElement(\"button\");\r\n    copyBtn.type = \"button\";\r\n    copyBtn.className = \"ces-set-btn\";\r\n    copyBtn.textContent = \"复制诊断\";\r\n    copyBtn.addEventListener(\"click\", function (ev) {\r\n      ev.stopPropagation();\r\n      var payload = JSON.stringify(dumpTrace(win), null, 2);\r\n      try {\r\n        if (win && win.navigator && win.navigator.clipboard && typeof win.navigator.clipboard.writeText === \"function\") {\r\n          win.navigator.clipboard.writeText(payload);\r\n        }\r\n      } catch (err) {\r\n        // 忽略剪贴板权限错误\r\n      }\r\n      copyBtn.textContent = \"已复制\";\r\n    });\r\n\r\n    var resetBtn = doc.createElement(\"button\");\r\n    resetBtn.type = \"button\";\r\n    resetBtn.className = \"ces-set-btn\";\r\n    resetBtn.textContent = \"恢复默认\";\r\n    resetBtn.addEventListener(\"click\", function (ev) {\r\n      ev.stopPropagation();\r\n      resetSettings(win);\r\n      refreshActiveButtons();\r\n    });\r\n\r\n    var closeBtn = doc.createElement(\"button\");\r\n    closeBtn.type = \"button\";\r\n    closeBtn.className = \"ces-set-btn\";\r\n    closeBtn.textContent = \"关闭\";\r\n\r\n    actions.appendChild(copyBtn);\r\n    actions.appendChild(resetBtn);\r\n    actions.appendChild(closeBtn);\r\n    panel.appendChild(actions);\r\n\r\n    refreshActiveButtons();\r\n    var offSettings = onSettingsChange(function () {\r\n      refreshActiveButtons();\r\n    }, win);\r\n\r\n    function closePanel() {\r\n      offSettings();\r\n      doc.removeEventListener(\"pointerdown\", onDocPointerDown, true);\r\n      doc.removeEventListener(\"keydown\", onDocKeyDown, true);\r\n      if (panel.parentNode) panel.parentNode.removeChild(panel);\r\n    }\r\n\r\n    closeBtn.addEventListener(\"click\", function (ev) {\r\n      ev.stopPropagation();\r\n      closePanel();\r\n    });\r\n\r\n    function onDocPointerDown(ev) {\r\n      if (!panel.contains(ev.target)) {\r\n        closePanel();\r\n      }\r\n    }\r\n    function onDocKeyDown(ev) {\r\n      if (ev && ev.key === \"Escape\") {\r\n        ev.stopPropagation();\r\n        closePanel();\r\n      }\r\n    }\r\n\r\n    doc.addEventListener(\"pointerdown\", onDocPointerDown, true);\r\n    doc.addEventListener(\"keydown\", onDocKeyDown, true);\r\n    doc.body.appendChild(panel);\r\n    return closePanel;\r\n  }\r\n\r\n  function installSettingsUi(options) {\r\n    var opts = options || {};\r\n    var doc = opts.document || (typeof document !== \"undefined\" ? document : null);\r\n    var win = opts.window || (doc && doc.defaultView) || (typeof window !== \"undefined\" ? window : globalRoot);\r\n    if (!doc) return { stop: function () {} };\r\n\r\n    var activeClose = null;\r\n    var longPressTimer = null;\r\n    var pressStartPos = null;\r\n\r\n    function isInsideSlider(target) {\r\n      if (!target || typeof target.closest !== \"function\") return null;\r\n      return target.closest(\".ces-inline, .ces-root, .ces-ag-effort-row\");\r\n    }\r\n\r\n    function clearLongPress() {\r\n      if (longPressTimer !== null) {\r\n        clearTimeout(longPressTimer);\r\n        longPressTimer = null;\r\n      }\r\n      pressStartPos = null;\r\n    }\r\n\r\n    function onContextMenu(ev) {\r\n      var host = isInsideSlider(ev.target);\r\n      if (!host) return;\r\n      ev.preventDefault();\r\n      ev.stopPropagation();\r\n      if (activeClose) activeClose();\r\n      activeClose = openSettingsPanel({\r\n        document: doc,\r\n        window: win,\r\n        x: ev.clientX || 120,\r\n        y: ev.clientY || 120\r\n      });\r\n    }\r\n\r\n    function onKeyDown(ev) {\r\n      var host = isInsideSlider(ev.target);\r\n      if (!host) return;\r\n      if (ev.key === \"ContextMenu\" || (ev.key === \"F10\" && ev.shiftKey)) {\r\n        ev.preventDefault();\r\n        ev.stopPropagation();\r\n        var rect = host.getBoundingClientRect ? host.getBoundingClientRect() : { left: 120, bottom: 120 };\r\n        if (activeClose) activeClose();\r\n        activeClose = openSettingsPanel({\r\n          document: doc,\r\n          window: win,\r\n          x: rect.left,\r\n          y: rect.bottom + 4\r\n        });\r\n      }\r\n    }\r\n\r\n    function onPointerDown(ev) {\r\n      var host = isInsideSlider(ev.target);\r\n      if (!host || ev.button === 2) return;\r\n      clearLongPress();\r\n      pressStartPos = { x: ev.clientX || 0, y: ev.clientY || 0 };\r\n      longPressTimer = setTimeout(function () {\r\n        longPressTimer = null;\r\n        if (activeClose) activeClose();\r\n        activeClose = openSettingsPanel({\r\n          document: doc,\r\n          window: win,\r\n          x: (pressStartPos && pressStartPos.x) || 120,\r\n          y: (pressStartPos && pressStartPos.y) || 120\r\n        });\r\n      }, 500);\r\n    }\r\n\r\n    function onPointerMove(ev) {\r\n      if (!pressStartPos || longPressTimer === null) return;\r\n      var dx = (ev.clientX || 0) - pressStartPos.x;\r\n      var dy = (ev.clientY || 0) - pressStartPos.y;\r\n      if (dx * dx + dy * dy > 36) {\r\n        clearLongPress();\r\n      }\r\n    }\r\n\r\n    function onPointerUp() {\r\n      clearLongPress();\r\n    }\r\n\r\n    doc.addEventListener(\"contextmenu\", onContextMenu, true);\r\n    doc.addEventListener(\"keydown\", onKeyDown, true);\r\n    doc.addEventListener(\"pointerdown\", onPointerDown, true);\r\n    doc.addEventListener(\"pointermove\", onPointerMove, true);\r\n    doc.addEventListener(\"pointerup\", onPointerUp, true);\r\n    doc.addEventListener(\"pointercancel\", onPointerUp, true);\r\n\r\n    return {\r\n      stop: function () {\r\n        clearLongPress();\r\n        if (activeClose) {\r\n          activeClose();\r\n          activeClose = null;\r\n        }\r\n        doc.removeEventListener(\"contextmenu\", onContextMenu, true);\r\n        doc.removeEventListener(\"keydown\", onKeyDown, true);\r\n        doc.removeEventListener(\"pointerdown\", onPointerDown, true);\r\n        doc.removeEventListener(\"pointermove\", onPointerMove, true);\r\n        doc.removeEventListener(\"pointerup\", onPointerUp, true);\r\n        doc.removeEventListener(\"pointercancel\", onPointerUp, true);\r\n      }\r\n    };\r\n  }\r\n\r\n  // ── DOM 与 Antigravity React Fiber 解析辅助函数 ─────────────────────────────\r\n  var INFERENCE_LABELS = [\"推理等级\", \"Reasoning effort\", \"Reasoning Effort\", \"Thinking effort\", \"推理强度\"];\r\n\r\n  function parseModelLabel(label) {\r\n    if (!label || typeof label !== \"string\") return null;\r\n    var match = AG_MODEL_LABEL_RE.exec(label.trim());\r\n    if (!match) return null;\r\n    var base = match[1].trim();\r\n    var effort = match[2].toLowerCase();\r\n    // 兼容展示名 \"(Extra)\" 与内部枚举 \"(xhigh)\"，统一归并到 xhigh 槽位进行排序与着色\r\n    if (effort === \"extra\") effort = \"xhigh\";\r\n    return {\r\n      base: base,\r\n      effort: effort,\r\n      effortLabel: AG_EFFORT_LABELS[effort] || match[2]\r\n    };\r\n  }\r\n\r\n  // ── 代理档位桥 ──────────────────────────────────────────────────────────────\r\n  // 原生模型选择器只认 low/medium/high/xhigh/max 五种标签，none/minimal/default\r\n  // 无法做成模型变体（会变成未分组的重复行）。滑条改为向第三方模型补丁的代理\r\n  // 询问每个模型真正支持的档位，并把选择结果按会话写回代理。\r\n  var AG_PROXY_DEFAULT_ORIGIN = \"http://127.0.0.1:50999\";\r\n  var AG_PROXY_SYNC_INTERVAL_MS = 2500;\r\n\r\n  var proxyEffort = {\r\n    byBase: new Map(),\r\n    current: new Map(),\r\n    signature: \"\",\r\n    conversationId: undefined,\r\n    lastFetchAt: 0,\r\n    inFlight: false,\r\n    available: false,\r\n    error: \"\",\r\n    listeners: new Set()\r\n  };\r\n\r\n  function proxyOrigin() {\r\n    try {\r\n      var storage = globalRoot && globalRoot.localStorage;\r\n      var saved = storage && storage.getItem(\"antigravity-codex-effort-slider:proxyOrigin\");\r\n      if (saved && /^http:\\/\\/(?:127\\.0\\.0\\.1|localhost):\\d+$/.test(saved)) return saved;\r\n    } catch (err) {\r\n      // localStorage 不可用时退回默认端口\r\n    }\r\n    return AG_PROXY_DEFAULT_ORIGIN;\r\n  }\r\n\r\n  function proxyBaseKey(label) {\r\n    if (!label) return \"\";\r\n    var parsed = parseModelLabel(String(label));\r\n    return (parsed ? parsed.base : String(label)).trim().toLowerCase();\r\n  }\r\n\r\n  function proxySignatureOf(byBase) {\r\n    var parts = [];\r\n    byBase.forEach(function (entry, key) {\r\n      parts.push(key + \":\" + entry.levels.join(\",\"));\r\n    });\r\n    parts.sort();\r\n    return parts.join(\"|\");\r\n  }\r\n\r\n  function proxyPayloadToMaps(list) {\r\n    var byBase = new Map();\r\n    var current = new Map();\r\n    for (var i = 0; i < list.length; i += 1) {\r\n      var model = list[i];\r\n      if (!model || !Array.isArray(model.levels) || !model.levels.length) continue;\r\n      var entry = {\r\n        name: model.name || \"\",\r\n        displayName: model.displayName || model.name || \"\",\r\n        levels: model.levels.slice()\r\n      };\r\n      var keys = [proxyBaseKey(entry.displayName), proxyBaseKey(entry.name)];\r\n      for (var k = 0; k < keys.length; k += 1) {\r\n        if (!keys[k]) continue;\r\n        byBase.set(keys[k], entry);\r\n        if (model.current) current.set(keys[k], String(model.current).toLowerCase());\r\n      }\r\n    }\r\n    return { byBase: byBase, current: current };\r\n  }\r\n\r\n  function notifyProxyEffortListeners() {\r\n    proxyEffort.listeners.forEach(function (fn) {\r\n      try {\r\n        fn();\r\n      } catch (err) {\r\n        // 忽略订阅者异常\r\n      }\r\n    });\r\n  }\r\n\r\n  function syncProxyEffort(conversationId) {\r\n    var root = globalRoot;\r\n    if (!root || typeof root.fetch !== \"function\" || proxyEffort.inFlight) return;\r\n    if (conversationId !== proxyEffort.conversationId) {\r\n      proxyEffort.conversationId = conversationId;\r\n      proxyEffort.lastFetchAt = 0;\r\n    }\r\n    var now = Date.now();\r\n    if (now - proxyEffort.lastFetchAt < AG_PROXY_SYNC_INTERVAL_MS) return;\r\n    proxyEffort.lastFetchAt = now;\r\n    proxyEffort.inFlight = true;\r\n    var url =\r\n      proxyOrigin() +\r\n      \"/plugin/effort/levels\" +\r\n      (conversationId ? \"?conversationId=\" + encodeURIComponent(String(conversationId)) : \"\");\r\n    root\r\n      .fetch(url, { method: \"GET\", credentials: \"omit\", cache: \"no-store\" })\r\n      .then(function (res) {\r\n        if (!res || !res.ok) throw new Error(\"HTTP \" + (res ? res.status : 0));\r\n        return res.json();\r\n      })\r\n      .then(function (data) {\r\n        var maps = proxyPayloadToMaps(data && Array.isArray(data.models) ? data.models : []);\r\n        var nextSignature = proxySignatureOf(maps.byBase);\r\n        var changed = nextSignature !== proxyEffort.signature;\r\n        proxyEffort.byBase = maps.byBase;\r\n        proxyEffort.current = maps.current;\r\n        proxyEffort.signature = nextSignature;\r\n        proxyEffort.available = maps.byBase.size > 0;\r\n        proxyEffort.error = \"\";\r\n        if (changed) notifyProxyEffortListeners();\r\n      })\r\n      .catch(function (err) {\r\n        proxyEffort.available = false;\r\n        proxyEffort.error = String((err && err.message) || err);\r\n      })\r\n      .then(function () {\r\n        proxyEffort.inFlight = false;\r\n      });\r\n  }\r\n\r\n  function pushProxyEffort(entry, level, conversationId) {\r\n    var key = proxyBaseKey(entry && (entry.displayName || entry.name));\r\n    if (key) proxyEffort.current.set(key, level);\r\n    var root = globalRoot;\r\n    if (!root || typeof root.fetch !== \"function\") return;\r\n    var payload = {\r\n      model: (entry && (entry.name || entry.displayName)) || key,\r\n      level: level,\r\n      conversationId: conversationId || null\r\n    };\r\n    root\r\n      .fetch(proxyOrigin() + \"/plugin/effort\", {\r\n        method: \"POST\",\r\n        headers: { \"Content-Type\": \"application/json\" },\r\n        credentials: \"omit\",\r\n        cache: \"no-store\",\r\n        body: JSON.stringify(payload)\r\n      })\r\n      .catch(function () {\r\n        // 下一次轮询会重新对齐\r\n      });\r\n  }\r\n\r\n  function findAntigravityTrigger(doc) {\r\n    var d = doc || (typeof document !== \"undefined\" ? document : null);\r\n    if (!d || typeof d.querySelector !== \"function\") return null;\r\n    return (\r\n      d.querySelector('[data-testid=\"model-selector-trigger\"]') ||\r\n      d.querySelector('button[aria-label^=\"Select model\"]')\r\n    );\r\n  }\r\n\r\n  function findAntigravityPanel(doc) {\r\n    var d = doc || (typeof document !== \"undefined\" ? document : null);\r\n    if (!d || typeof d.querySelector !== \"function\") return null;\r\n    return d.querySelector('[data-testid=\"model-selector-panel\"]');\r\n  }\r\n\r\n  function findPermissionsTrigger(doc) {\r\n    var d = doc || (typeof document !== \"undefined\" ? document : null);\r\n    if (!d || typeof d.querySelector !== \"function\") return null;\r\n    var boxed = d.querySelector('[data-testid=\"agent-input-box\"] [data-testid=\"permissions-selector-trigger\"]');\r\n    if (boxed) return boxed;\r\n    var direct = d.querySelector('[data-testid=\"permissions-selector-trigger\"]');\r\n    if (direct) return direct;\r\n    if (typeof d.querySelectorAll !== \"function\") return null;\r\n    var buttons = d.querySelectorAll(\"button, [role='button']\");\r\n    for (var i = 0; i < buttons.length; i += 1) {\r\n      var btn = buttons[i];\r\n      var aria = (btn.getAttribute && btn.getAttribute(\"aria-label\")) || \"\";\r\n      if (/permission/i.test(aria)) return btn;\r\n    }\r\n    return null;\r\n  }\r\n\r\n  function nodeIsConnected(el, doc) {\r\n    if (!el) return false;\r\n    if (typeof el.isConnected === \"boolean\") return el.isConnected;\r\n    try {\r\n      if (doc && typeof doc.contains === \"function\") return doc.contains(el);\r\n    } catch (err) {\r\n      // 测试 mock 可能没有 contains\r\n    }\r\n    return Boolean(el.parentNode);\r\n  }\r\n\r\n  function findInferenceRow(doc) {\r\n    var d = doc || (typeof document !== \"undefined\" ? document : null);\r\n    if (!d || typeof d.querySelectorAll !== \"function\") return null;\r\n    var explicit = d.querySelector('[data-ces-effort-row=\"true\"]');\r\n    if (explicit) return explicit;\r\n\r\n    var menus = d.querySelectorAll('[role=\"menu\"], .surface-menu, [data-testid=\"model-selector-panel\"]');\r\n    for (var mIdx = 0; mIdx < menus.length; mIdx += 1) {\r\n      var menu = menus[mIdx];\r\n      var items = menu.querySelectorAll('[role=\"menuitem\"], .ces-ag-effort-row, div, button');\r\n      for (var i = 0; i < items.length; i += 1) {\r\n        var el = items[i];\r\n        var txt = (el.textContent || \"\").trim();\r\n        for (var k = 0; k < INFERENCE_LABELS.length; k += 1) {\r\n          var kw = INFERENCE_LABELS[k];\r\n          if (txt === kw || txt.indexOf(kw) === 0) {\r\n            return el.closest('[role=\"menuitem\"]') || el;\r\n          }\r\n        }\r\n      }\r\n    }\r\n    return null;\r\n  }\r\n\r\n  function findValueElement(row) {\r\n    if (!row || typeof row.querySelector !== \"function\") return null;\r\n    var explicit = row.querySelector('[data-ces-part=\"value\"], .ces-ag-effort-value');\r\n    if (explicit) return explicit;\r\n\r\n    var children = row.querySelectorAll(\"span, div\");\r\n    var candidate = null;\r\n    for (var i = 0; i < children.length; i += 1) {\r\n      var child = children[i];\r\n      if (child.closest && child.closest(\".ces-inline\")) continue;\r\n      if (child.children && child.children.length > 0) continue;\r\n      var t = (child.textContent || \"\").trim();\r\n      if (!t) continue;\r\n      var isHeaderLabel = false;\r\n      for (var k = 0; k < INFERENCE_LABELS.length; k += 1) {\r\n        if (t === INFERENCE_LABELS[k]) {\r\n          isHeaderLabel = true;\r\n          break;\r\n        }\r\n      }\r\n      if (!isHeaderLabel) candidate = child;\r\n    }\r\n    return candidate;\r\n  }\r\n\r\n  function findEffortTrigger(doc) {\r\n    var d = doc || (typeof document !== \"undefined\" ? document : null);\r\n    if (!d || typeof d.querySelectorAll !== \"function\") return null;\r\n\r\n    // 1. 优先匹配 Antigravity 原生模型选择器按钮中的档位 span (<span class=\"opacity-70\"> High</span>)\r\n    var agTrigger = findAntigravityTrigger(d);\r\n    if (agTrigger) {\r\n      var effortSpan = agTrigger.querySelector(\"span.opacity-70, [data-ces-part='trigger-effort']\");\r\n      if (effortSpan) return effortSpan;\r\n      return agTrigger;\r\n    }\r\n\r\n    // 2. 兼容通用 composer 触发器（如包含 \" · \" 的按钮）\r\n    var composers = d.querySelectorAll(\".surface-composer, .surface-composer-card, form, body\");\r\n    for (var cIdx = 0; cIdx < composers.length; cIdx += 1) {\r\n      var buttons = composers[cIdx].querySelectorAll('button[aria-haspopup=\"menu\"]');\r\n      for (var bIdx = 0; bIdx < buttons.length; bIdx += 1) {\r\n        var btn = buttons[bIdx];\r\n        if ((btn.textContent || \"\").indexOf(\" · \") >= 0) return btn;\r\n      }\r\n    }\r\n    return null;\r\n  }\r\n\r\n  function syncTriggerColor(doc, label, index, count, isMax, hasOffFirst, isClaude) {\r\n    var d = doc || (typeof document !== \"undefined\" ? document : null);\r\n    if (!d) return;\r\n    var agTrigger = findAntigravityTrigger(d);\r\n    var claudeFlag = typeof isClaude === \"boolean\" ? isClaude : isClaudeModel(agTrigger ? agTrigger.textContent : \"\");\r\n    var color = valueColorFor(label, index, count, isMax, hasOffFirst, claudeFlag);\r\n\r\n    // 1. Antigravity 原生触发按钮：只给档位后缀 span 着色，保持模型名称本身清晰易读\r\n    var agTrigger = findAntigravityTrigger(d);\r\n    if (agTrigger) {\r\n      var effortSpan = agTrigger.querySelector(\"span.opacity-70, [data-ces-part='trigger-effort']\");\r\n      if (effortSpan) {\r\n        effortSpan.setAttribute(\"data-ces-part\", \"trigger-effort\");\r\n        effortSpan.style.color = color || \"\";\r\n        effortSpan.style.opacity = color ? \"1\" : \"\";\r\n        effortSpan.style.fontWeight = color ? \"600\" : \"\";\r\n      }\r\n      return;\r\n    }\r\n\r\n    // 2. 兼容通用触发按钮\r\n    var trigger = findEffortTrigger(d);\r\n    if (!trigger) return;\r\n    var spans = trigger.querySelectorAll(\"span\");\r\n    var target = spans.length > 0 ? spans[spans.length - 1] : trigger;\r\n    target.style.color = color || \"\";\r\n  }\r\n\r\n  function findSeatEffort(win) {\r\n    var w = win || (typeof window !== \"undefined\" ? window : globalRoot);\r\n    var map = w && w.__dshSeats;\r\n    if (!map || typeof map.forEach !== \"function\") return null;\r\n    var found = null;\r\n    map.forEach(function (seat) {\r\n      if (found) return;\r\n      if (seat && Array.isArray(seat.effortLevels)) {\r\n        found = seat;\r\n      }\r\n    });\r\n    return found;\r\n  }\r\n\r\n  function getReactFiber(el) {\r\n    if (!el || typeof el !== \"object\") return null;\r\n    var raw = null;\r\n    var keys = Object.keys(el);\r\n    for (var i = 0; i < keys.length; i += 1) {\r\n      var k = keys[i];\r\n      if (k.indexOf(\"__reactFiber$\") === 0 || k.indexOf(\"__reactInternalInstance$\") === 0) {\r\n        raw = el[k];\r\n        break;\r\n      }\r\n    }\r\n    if (!raw) return null;\r\n    if (raw.alternate) {\r\n      var root = raw;\r\n      var guard = 0;\r\n      while (root.return && guard < 80) {\r\n        root = root.return;\r\n        guard += 1;\r\n      }\r\n      if (root && root.stateNode && root.stateNode.current && root.stateNode.current !== root) {\r\n        return raw.alternate;\r\n      }\r\n    }\r\n    return raw;\r\n  }\r\n\r\n  function buildEffortIndexFromOptions(modelOptions) {\r\n    var indexMap = new Map();\r\n    var list = Array.isArray(modelOptions) ? modelOptions : [];\r\n    for (var i = 0; i < list.length; i += 1) {\r\n      var opt = list[i];\r\n      if (!opt || opt.isCustom || typeof opt.label !== \"string\") continue;\r\n      var parsed = parseModelLabel(opt.label);\r\n      if (!parsed) continue;\r\n      var byEffort = indexMap.get(parsed.base);\r\n      if (!byEffort) {\r\n        byEffort = new Map();\r\n        indexMap.set(parsed.base, byEffort);\r\n      }\r\n      if (!byEffort.has(parsed.effort)) {\r\n        byEffort.set(parsed.effort, opt);\r\n      }\r\n    }\r\n    return indexMap;\r\n  }\r\n\r\n  // Antigravity 2.34+ keys the native provider effortIndex by model slug\r\n  // (\"gemini-3.8-flash\") while the slider resolves profiles by display base\r\n  // (\"Gemini 3.8 Flash\"). Re-key the native index to display bases so native\r\n  // effort groups keep resolving; merge in the label-derived index as fallback.\r\n  function displayBaseEffortIndex(nativeIndex, modelOptions) {\r\n    var out = new Map();\r\n    if (nativeIndex instanceof Map) {\r\n      nativeIndex.forEach(function (byEffort, key) {\r\n        if (!(byEffort instanceof Map)) return;\r\n        var base = null;\r\n        byEffort.forEach(function (opt) {\r\n          if (base) return;\r\n          var p = opt && typeof opt.label === \"string\" ? parseModelLabel(opt.label) : null;\r\n          if (p) base = p.base;\r\n        });\r\n        out.set(base || key, byEffort);\r\n      });\r\n    }\r\n    buildEffortIndexFromOptions(modelOptions).forEach(function (byEffort, base) {\r\n      if (!out.has(base)) out.set(base, byEffort);\r\n    });\r\n    return out;\r\n  }\r\n\r\n  /**\r\n   * 从 Antigravity 的 DOM 节点向上遍历 React Fiber 树，提取：\r\n   * - OXb.Provider: effortIndex, modelOptions, selectedModel, groups\r\n   * - $Xb         : 未包装 setIsOpen(false) 的 setSelectedModel, open, setIsOpen\r\n   * - cYb         : conversationId\r\n   * - eKa.Provider: setModelConfigByLabelForConversation（直接切档不关菜单、不抢焦点）\r\n   */\r\n  function readAntigravityFiberContext(el) {\r\n    var startFiber = getReactFiber(el);\r\n    if (!startFiber) return null;\r\n\r\n    var selectorCtx = null;\r\n    var innerPopoverProps = null;\r\n    var outerPopoverProps = null;\r\n    var conversationId = undefined;\r\n    var hasConversationSelector = false;\r\n    var globalModelCtx = null;\r\n\r\n    var cur = startFiber;\r\n    for (var step = 0; cur && step < 500; step += 1, cur = cur.return) {\r\n      var props = cur.memoizedProps;\r\n      if (!props || typeof props !== \"object\") continue;\r\n\r\n      // 1. OXb.Provider / WJc.Provider (ModelSelectorProvider)\r\n      if (!selectorCtx && props.value && typeof props.value === \"object\") {\r\n        var val = props.value;\r\n        if (val.effortIndex instanceof Map && Array.isArray(val.modelOptions)) {\r\n          selectorCtx = val;\r\n        }\r\n      }\r\n\r\n      // 2. $Xb / hKc / XJc (ModelSelectorPopover 及其各层包装)\r\n      if (\r\n        typeof props.setIsOpen === \"function\" &&\r\n        typeof props.setSelectedModel === \"function\" &&\r\n        Array.isArray(props.modelOptions)\r\n      ) {\r\n        if (!innerPopoverProps) innerPopoverProps = props;\r\n        outerPopoverProps = props;\r\n      }\r\n\r\n      // 3. cYb / kKc (ConversationModelSelector)\r\n      if (!hasConversationSelector && (\"conversationId\" in props) && (\"placement\" in props)) {\r\n        hasConversationSelector = true;\r\n        conversationId = props.conversationId;\r\n      }\r\n\r\n      // 4. eKa.Provider (Global Model Context，在 Antigravity Web 中通常位于 ~170 层 Fiber 高度)\r\n      if (\r\n        !globalModelCtx &&\r\n        props.value &&\r\n        typeof props.value === \"object\" &&\r\n        typeof props.value.setModelConfigByLabelForConversation === \"function\"\r\n      ) {\r\n        globalModelCtx = props.value;\r\n      }\r\n\r\n      if (selectorCtx && outerPopoverProps && hasConversationSelector && globalModelCtx) {\r\n        break;\r\n      }\r\n    }\r\n\r\n    if (!selectorCtx && !innerPopoverProps && !outerPopoverProps && !globalModelCtx) return null;\r\n\r\n    var modelOptions =\r\n      (outerPopoverProps && outerPopoverProps.modelOptions) ||\r\n      (innerPopoverProps && innerPopoverProps.modelOptions) ||\r\n      (selectorCtx && selectorCtx.modelOptions) ||\r\n      (globalModelCtx && globalModelCtx.visibleModelConfigs) ||\r\n      [];\r\n\r\n    var selectedModel =\r\n      (outerPopoverProps && outerPopoverProps.selectedModel) ||\r\n      (innerPopoverProps && innerPopoverProps.selectedModel) ||\r\n      (selectorCtx && selectorCtx.selectedModel) ||\r\n      (globalModelCtx &&\r\n        (hasConversationSelector && typeof globalModelCtx.getModelConfigForConversation === \"function\"\r\n          ? globalModelCtx.getModelConfigForConversation(conversationId)\r\n          : globalModelCtx.currentModelConfig)) ||\r\n      null;\r\n\r\n    var effortIndex =\r\n      selectorCtx && selectorCtx.effortIndex instanceof Map\r\n        ? displayBaseEffortIndex(selectorCtx.effortIndex, modelOptions)\r\n        : buildEffortIndexFromOptions(modelOptions);\r\n\r\n    // ★ 关键：在 Antigravity IDE (VSCode / agy.exe) 中：\r\n    // kKc 将原始未包装的 setSelectedModel 传给 hKc；\r\n    // hKc 内部将其包装为 g = (m) => { b(m); c(!1); } 并传给子组件 XJc 和 Provider；\r\n    // 爬树遍历时从内部向外爬，innerPopoverProps 是 XJc (带 c(!1) 强制闭合菜单逻辑)，\r\n    // 而最外层的 outerPopoverProps (hKc) 才是最原始未包装关菜单的纯净 setter！\r\n    var unwrappedSetter =\r\n      (outerPopoverProps && typeof outerPopoverProps.setSelectedModel === \"function\" ? outerPopoverProps.setSelectedModel : null) ||\r\n      (innerPopoverProps && typeof innerPopoverProps.setSelectedModel === \"function\" ? innerPopoverProps.setSelectedModel : null) ||\r\n      (selectorCtx && typeof selectorCtx.setSelectedModel === \"function\" ? selectorCtx.setSelectedModel : null);\r\n\r\n    var setIsOpenFn =\r\n      (outerPopoverProps && typeof outerPopoverProps.setIsOpen === \"function\" ? outerPopoverProps.setIsOpen : null) ||\r\n      (innerPopoverProps && typeof innerPopoverProps.setIsOpen === \"function\" ? innerPopoverProps.setIsOpen : null) ||\r\n      (selectorCtx && typeof selectorCtx.setIsOpen === \"function\" ? selectorCtx.setIsOpen : null);\r\n\r\n    return {\r\n      effortIndex: effortIndex,\r\n      modelOptions: modelOptions,\r\n      selectedModel: selectedModel,\r\n      groups: (selectorCtx && selectorCtx.groups) || [],\r\n      conversationId: conversationId,\r\n      hasConversationSelector: hasConversationSelector,\r\n      setModelConfigByLabelForConversation:\r\n        globalModelCtx && typeof globalModelCtx.setModelConfigByLabelForConversation === \"function\"\r\n          ? globalModelCtx.setModelConfigByLabelForConversation\r\n          : null,\r\n      setCurrentModelConfigByLabel:\r\n        globalModelCtx && typeof globalModelCtx.setCurrentModelConfigByLabel === \"function\"\r\n          ? globalModelCtx.setCurrentModelConfigByLabel\r\n          : null,\r\n      unwrappedSetSelectedModel: unwrappedSetter,\r\n      setIsOpen: setIsOpenFn,\r\n      isOpen: Boolean((outerPopoverProps && outerPopoverProps.open) || (innerPopoverProps && innerPopoverProps.open))\r\n    };\r\n  }\r\n\r\n  /**\r\n   * 剖析当前选中模型（或指定 baseName 模型）在 Antigravity 中的可用推理档位列表\r\n   */\r\n  function resolveModelEffortProfile(ctx, targetModelOrBase, perModelEffortMap) {\r\n    if (!ctx) return null;\r\n    var selected = ctx.selectedModel;\r\n    var modelObj = null;\r\n    var baseName = \"\";\r\n    var activeEffort = \"\";\r\n\r\n    if (typeof targetModelOrBase === \"string\" && targetModelOrBase) {\r\n      baseName = targetModelOrBase;\r\n    } else if (targetModelOrBase && typeof targetModelOrBase === \"object\") {\r\n      modelObj = targetModelOrBase;\r\n    } else {\r\n      modelObj = selected;\r\n    }\r\n\r\n    if (modelObj && typeof modelObj.label === \"string\") {\r\n      var parsed = parseModelLabel(modelObj.label);\r\n      if (parsed) {\r\n        baseName = parsed.base;\r\n        activeEffort = parsed.effort;\r\n      } else {\r\n        baseName = modelObj.label;\r\n      }\r\n    }\r\n\r\n    // 代理档位优先：这是 none/minimal/default 等原生选择器没有的档位来源。\r\n    var proxyEntry = baseName ? proxyEffort.byBase.get(proxyBaseKey(baseName)) : null;\r\n    if (proxyEntry && proxyEntry.levels.length >= 2) {\r\n      var proxyLevels = proxyEntry.levels.slice();\r\n      var proxyKey = proxyBaseKey(baseName);\r\n      var proxyCurrent = proxyEffort.current.get(proxyKey);\r\n      if (!proxyCurrent || proxyLevels.indexOf(proxyCurrent) < 0) {\r\n        if (activeEffort && proxyLevels.indexOf(activeEffort) >= 0) {\r\n          proxyCurrent = activeEffort;\r\n        } else if (perModelEffortMap && proxyLevels.indexOf(perModelEffortMap.get(baseName)) >= 0) {\r\n          proxyCurrent = perModelEffortMap.get(baseName);\r\n        } else {\r\n          proxyCurrent = proxyLevels[0];\r\n        }\r\n      }\r\n      var proxyItems = proxyLevels.map(function (level) {\r\n        return {\r\n          effort: level,\r\n          label: AG_EFFORT_LABELS[level] || level,\r\n          modelOption: modelObj || selected,\r\n          proxy: true,\r\n          proxyBase: baseName,\r\n          proxyModel: proxyEntry.name\r\n        };\r\n      });\r\n      var proxyIndex = Math.max(0, proxyLevels.indexOf(proxyCurrent));\r\n      return {\r\n        baseName: baseName,\r\n        isClaude: isClaudeModel(baseName),\r\n        theme: isClaudeModel(baseName) ? \"claude\" : \"codex\",\r\n        locked: false,\r\n        proxy: true,\r\n        proxyModel: proxyEntry.name,\r\n        levels: proxyItems,\r\n        currentIndex: proxyIndex,\r\n        currentEffort: proxyLevels[proxyIndex],\r\n        currentLabel: AG_EFFORT_LABELS[proxyLevels[proxyIndex]] || proxyLevels[proxyIndex],\r\n        modelOption: modelObj || selected\r\n      };\r\n    }\r\n\r\n    var byEffort = baseName && ctx.effortIndex instanceof Map ? ctx.effortIndex.get(baseName) : null;\r\n    if (byEffort && byEffort.size >= 2) {\r\n      var sortedKeys = [];\r\n      for (var i = 0; i < AG_EFFORT_ORDER.length; i += 1) {\r\n        var key = AG_EFFORT_ORDER[i];\r\n        if (byEffort.has(key)) sortedKeys.push(key);\r\n      }\r\n      if (!activeEffort) {\r\n        if (perModelEffortMap && perModelEffortMap.has(baseName)) {\r\n          var remembered = perModelEffortMap.get(baseName);\r\n          if (byEffort.has(remembered)) activeEffort = remembered;\r\n        }\r\n        if (!activeEffort) {\r\n          var selParsed = selected && parseModelLabel(selected.label);\r\n          if (selParsed && selParsed.base === baseName && byEffort.has(selParsed.effort)) {\r\n            activeEffort = selParsed.effort;\r\n          } else if (byEffort.has(\"medium\")) {\r\n            activeEffort = \"medium\";\r\n          } else {\r\n            activeEffort = sortedKeys[0] || \"\";\r\n          }\r\n        }\r\n      }\r\n      var levels = sortedKeys.map(function (k) {\r\n        var opt = byEffort.get(k);\r\n        return {\r\n          effort: k,\r\n          label: AG_EFFORT_LABELS[k] || k,\r\n          modelOption: opt\r\n        };\r\n      });\r\n      var currentIndex = Math.max(0, sortedKeys.indexOf(activeEffort));\r\n      var isClaude = isClaudeModel(baseName);\r\n      var theme = isClaude ? \"claude\" : \"codex\";\r\n      return {\r\n        baseName: baseName,\r\n        isClaude: isClaude,\r\n        theme: theme,\r\n        locked: false,\r\n        levels: levels,\r\n        currentIndex: currentIndex,\r\n        currentEffort: sortedKeys[currentIndex] || activeEffort,\r\n        currentLabel: AG_EFFORT_LABELS[sortedKeys[currentIndex]] || activeEffort,\r\n        modelOption: byEffort.get(sortedKeys[currentIndex]) || modelObj\r\n      };\r\n    }\r\n\r\n    // 单档位模型（如 GPT-OSS 120B (Medium)）或自定义模型：锁定不可拖动\r\n    var singleParsed = modelObj && parseModelLabel(modelObj.label);\r\n    var singleEffort = singleParsed ? singleParsed.effort : \"medium\";\r\n    var singleLabel = singleParsed ? singleParsed.effortLabel : \"固定\";\r\n    var isClaudeSingle = isClaudeModel(baseName || (modelObj && modelObj.label));\r\n    return {\r\n      baseName: baseName || (modelObj && modelObj.label) || \"\",\r\n      isClaude: isClaudeSingle,\r\n      theme: isClaudeSingle ? \"claude\" : \"codex\",\r\n      locked: true,\r\n      levels: [\r\n        {\r\n          effort: singleEffort,\r\n          label: singleLabel,\r\n          modelOption: modelObj\r\n        }\r\n      ],\r\n      currentIndex: 0,\r\n      currentEffort: singleEffort,\r\n      currentLabel: singleLabel,\r\n      modelOption: modelObj\r\n    };\r\n  }\r\n\r\n  function syncModelMenuOpen(ctx, keepMenuOpen) {\r\n    if (!ctx || typeof ctx.setIsOpen !== \"function\") return;\r\n    try {\r\n      ctx.setIsOpen(keepMenuOpen ? true : false);\r\n    } catch (err) {\r\n      // 忽略外部状态同步异常\r\n    }\r\n  }\r\n\r\n  function commitAntigravityModelOption(ctx, targetOption, flags) {\r\n    if (!ctx || !targetOption || !targetOption.label) return false;\r\n    var keepMenuOpen = !flags || flags.keepMenuOpen !== false;\r\n    try {\r\n      // 优先调用 eKa.Provider 的 setModelConfigByLabelForConversation：\r\n      // 直接更新当前会话与全局默认模型，不触发 $Xb 的 setIsOpen(false) 关菜单，也不触发编辑器抢焦点\r\n      if (typeof ctx.setModelConfigByLabelForConversation === \"function\") {\r\n        ctx.setModelConfigByLabelForConversation(targetOption.label, ctx.conversationId, true);\r\n        if (!keepMenuOpen) syncModelMenuOpen(ctx, false);\r\n        return true;\r\n      }\r\n      if (typeof ctx.unwrappedSetSelectedModel === \"function\") {\r\n        // 核心保护：\r\n        // 1. kKc 的 setSelectedModel 内部最后会同步调用 getLexicalEditor()?.focus() 抢夺焦点，\r\n        //    导致 Radix Popover / @base-ui/react 菜单捕获 focusout/onFocusOutside 触发关闭；\r\n        //    此处在调用期间临时屏蔽 Lexical editor 及全局 DOM focus 抢夺\r\n        var doc = typeof document !== \"undefined\" ? document : null;\r\n        var editable = doc && doc.querySelector ? doc.querySelector('[contenteditable=\"true\"]') : null;\r\n        var editorInst = editable ? editable.__lexicalEditor : null;\r\n        var editorProto = editorInst ? Object.getPrototypeOf(editorInst) : null;\r\n        var origEditorFocus = editorProto && typeof editorProto.focus === \"function\" ? editorProto.focus : null;\r\n        var origInstFocus = editorInst && Object.prototype.hasOwnProperty.call(editorInst, \"focus\") ? editorInst.focus : null;\r\n\r\n        var origHtmlFocus = typeof HTMLElement !== \"undefined\" && HTMLElement.prototype ? HTMLElement.prototype.focus : null;\r\n        var origElemFocus = typeof Element !== \"undefined\" && Element.prototype ? Element.prototype.focus : null;\r\n\r\n        var noop = function () {};\r\n        if (origEditorFocus) editorProto.focus = noop;\r\n        if (origInstFocus) editorInst.focus = noop;\r\n        if (origHtmlFocus) HTMLElement.prototype.focus = noop;\r\n        if (origElemFocus) Element.prototype.focus = noop;\r\n\r\n        try {\r\n          ctx.unwrappedSetSelectedModel(targetOption);\r\n        } finally {\r\n          if (origEditorFocus) editorProto.focus = origEditorFocus;\r\n          if (origInstFocus) editorInst.focus = origInstFocus;\r\n          if (origHtmlFocus) HTMLElement.prototype.focus = origHtmlFocus;\r\n          if (origElemFocus) Element.prototype.focus = origElemFocus;\r\n        }\r\n\r\n        // 2. 模型菜单内切档保持开启；输入框常驻滑条切档则强制关闭，避免把左侧模型栏弹出来\r\n        syncModelMenuOpen(ctx, keepMenuOpen);\r\n        return true;\r\n      }\r\n      if (typeof ctx.setCurrentModelConfigByLabel === \"function\") {\r\n        ctx.setCurrentModelConfigByLabel(targetOption.label);\r\n        return true;\r\n      }\r\n    } catch (err) {\r\n      tracePush(\"ag-commit-error\", { message: String(err && err.message ? err.message : err) });\r\n    }\r\n    return false;\r\n  }\r\n\r\n  // ── 核心滑条挂载器（零外部框架依赖，纯 DOM + 连续物理帧循环） ─────────────────\r\n  function extractEffortKey(item) {\r\n    if (item === null || item === undefined) return \"\";\r\n    if (typeof item === \"string\") return item;\r\n    if (typeof item === \"object\") {\r\n      return String(item.effort || item.id || item.value || item.key || item.label || \"\");\r\n    }\r\n    return String(item);\r\n  }\r\n\r\n  function extractEffortDisplayLabel(item, effortKey, seat) {\r\n    if (item && typeof item === \"object\" && typeof item.label === \"string\" && item.label) {\r\n      return item.label;\r\n    }\r\n    if (seat && typeof seat.formatEffortLabel === \"function\") {\r\n      try {\r\n        var formatted = seat.formatEffortLabel(effortKey);\r\n        if (formatted) return String(formatted);\r\n      } catch (err) {\r\n        // 忽略格式化异常\r\n      }\r\n    }\r\n    var lower = String(effortKey || \"\").toLowerCase();\r\n    if (AG_EFFORT_LABELS[lower]) return AG_EFFORT_LABELS[lower];\r\n    return String(effortKey || \"\");\r\n  }\r\n\r\n  function mountCodexEffortSlider(options) {\r\n    var opts = options || {};\r\n    var container = opts.container;\r\n    var seat = opts.seat;\r\n    var doc = opts.document || (container && container.ownerDocument) || (typeof document !== \"undefined\" ? document : null);\r\n    var win = opts.window || (doc && doc.defaultView) || (typeof window !== \"undefined\" ? window : globalRoot);\r\n\r\n    if (!container || !doc) {\r\n      return { unmount: function () {}, refresh: function () {} };\r\n    }\r\n\r\n    var compact = Boolean(opts.compact);\r\n    var knobRadius = compact ? 8 : KNOB_RADIUS;\r\n\r\n    installStyles(doc);\r\n\r\n    // 清空宿主容器并构建 DOM 树（对齐 dsh-codex-effort-slider 四层结构：fill / energy+sweep / stars+dot / knob）\r\n    container.innerHTML = \"\";\r\n    var rootEl = doc.createElement(\"div\");\r\n    rootEl.className = \"ces-root\";\r\n    rootEl.setAttribute(\"role\", \"slider\");\r\n    rootEl.setAttribute(\"aria-label\", \"推理等级\");\r\n\r\n    var trackEl = doc.createElement(\"div\");\r\n    trackEl.className = \"ces-track\";\r\n    trackEl.setAttribute(\"data-ces-part\", \"track\");\r\n\r\n    var fillEl = doc.createElement(\"div\");\r\n    fillEl.className = \"ces-fill\";\r\n    fillEl.setAttribute(\"data-ces-part\", \"fill\");\r\n    trackEl.appendChild(fillEl);\r\n\r\n    var energyEl = doc.createElement(\"div\");\r\n    energyEl.className = \"ces-energy\";\r\n    energyEl.setAttribute(\"data-ces-part\", \"energy\");\r\n    var sweepEl = doc.createElement(\"div\");\r\n    sweepEl.className = \"ces-energy__sweep\";\r\n    sweepEl.setAttribute(\"data-ces-part\", \"sweep\");\r\n    energyEl.appendChild(sweepEl);\r\n    trackEl.appendChild(energyEl);\r\n\r\n    var starsEl = doc.createElement(\"div\");\r\n    starsEl.className = \"ces-stars\";\r\n    starsEl.setAttribute(\"data-ces-part\", \"stars\");\r\n\r\n    var starNodes = [];\r\n    for (var sIdx = 0; sIdx < PARTICLES.length; sIdx += 1) {\r\n      var p = PARTICLES[sIdx];\r\n      var starEl = doc.createElement(\"span\");\r\n      starEl.className = \"ces-star\";\r\n      starEl.setAttribute(\"data-ces-part\", \"star\");\r\n      starEl.style.top = p.y + \"%\";\r\n      starEl.style.display = \"none\";\r\n\r\n      var dotEl = doc.createElement(\"span\");\r\n      dotEl.className = \"ces-star__dot\";\r\n      dotEl.setAttribute(\"data-ces-part\", \"particle\");\r\n      var bStr = p.brightness.toFixed(3);\r\n      dotEl.setAttribute(\"data-brightness\", bStr);\r\n      dotEl.style.setProperty(\"--ces-b\", bStr);\r\n      starEl.appendChild(dotEl);\r\n\r\n      starsEl.appendChild(starEl);\r\n      starNodes.push({ el: starEl, dot: dotEl, meta: p });\r\n    }\r\n    trackEl.appendChild(starsEl);\r\n\r\n    var ticksEl = doc.createElement(\"div\");\r\n    ticksEl.className = \"ces-ticks\";\r\n    ticksEl.setAttribute(\"data-ces-part\", \"ticks\");\r\n    trackEl.appendChild(ticksEl);\r\n\r\n    var claudeCanvasEl = doc.createElement(\"canvas\");\r\n    claudeCanvasEl.className = \"ces-claude-canvas\";\r\n    claudeCanvasEl.setAttribute(\"data-ces-part\", \"claude-canvas\");\r\n    claudeCanvasEl.width = 280;\r\n    claudeCanvasEl.height = 28;\r\n    trackEl.appendChild(claudeCanvasEl);\r\n\r\n    var knobEl = doc.createElement(\"div\");\r\n    knobEl.className = \"ces-knob\";\r\n    knobEl.setAttribute(\"data-ces-part\", \"knob\");\r\n    var knobNotchEl = doc.createElement(\"div\");\r\n    knobNotchEl.className = \"ces-knob-notch\";\r\n    knobEl.appendChild(knobNotchEl);\r\n    trackEl.appendChild(knobEl);\r\n\r\n    rootEl.appendChild(trackEl);\r\n    container.appendChild(rootEl);\r\n\r\n    // ── 内部状态机 ──────────────────────────────────────────────────────────\r\n    var destroyed = false;\r\n    var rafId = null;\r\n    var lastFrameMs = 0;\r\n\r\n    var claudeRafId = null;\r\n    var claudeAnimStart = 0;\r\n    // 点阵流动相位（秒）：按「帧间隔 × 当前速度倍率」累加，而不是 elapsed × 倍率，\r\n    // 这样拖动中速度连续变化时波纹不会因倍率突变而跳帧/倒退\r\n    var claudeFlowTime = 0;\r\n    var claudeLastTs = 0;\r\n    // 当前位置对应的强度与速度（由 applyVisualPct 每次刷新，RAF 循环读取）\r\n    var claudeIntensity = 0;\r\n    var claudeSpeed = 0;\r\n\r\n    var dragging = false;\r\n    var buttonDown = false;\r\n    var draftPct = null;\r\n    var draftIndex = null;\r\n    var snapIndex = null;\r\n    var detentIndex = -1;\r\n    var lastCommittedIndex = -1;\r\n\r\n    var lastPtrPct = null;\r\n    var lastPtrMs = 0;\r\n    var ptrSpeed = 0;\r\n\r\n    var motionState = null;\r\n    var tickNodes = [];\r\n    var lastRenderedTickCount = -1;\r\n    var lastAppliedEnergy = -1;\r\n    var lastAppliedSlowdown = -1;\r\n\r\n    function nowMs() {\r\n      if (win && win.performance && typeof win.performance.now === \"function\") {\r\n        return win.performance.now();\r\n      }\r\n      return Date.now();\r\n    }\r\n\r\n    function readSeatSnapshot() {\r\n      var rawLevels = (seat && Array.isArray(seat.effortLevels) ? seat.effortLevels : []).slice();\r\n      var levels = rawLevels.map(function (item) {\r\n        var key = extractEffortKey(item);\r\n        return {\r\n          raw: item,\r\n          effort: key,\r\n          label: extractEffortDisplayLabel(item, key, seat)\r\n        };\r\n      });\r\n      var count = levels.length;\r\n      var curEffort = extractEffortKey(seat && seat.currentEffort);\r\n      var officialIndex = 0;\r\n      for (var i = 0; i < count; i += 1) {\r\n        if (String(levels[i].effort).toLowerCase() === String(curEffort).toLowerCase()) {\r\n          officialIndex = i;\r\n          break;\r\n        }\r\n      }\r\n      var locked = Boolean((seat && seat.locked) || count <= 1);\r\n      var stops = energyStopsFor(levels);\r\n      var baseName = (seat && seat.baseName) || (seat && seat.modelName) || \"\";\r\n      var isClaude = Boolean((seat && seat.isClaude) || isClaudeModel(baseName));\r\n      var theme = (seat && seat.theme) || (isClaude ? \"claude\" : \"codex\");\r\n      return {\r\n        baseName: baseName,\r\n        isClaude: isClaude,\r\n        theme: theme,\r\n        levels: levels,\r\n        count: count,\r\n        officialIndex: officialIndex,\r\n        locked: locked,\r\n        energyStart: stops.start,\r\n        energyEnd: stops.end,\r\n        hasOffFirst: stops.hasOffFirst\r\n      };\r\n    }\r\n\r\n    function currentShownIndex(snap) {\r\n      if (dragging && draftIndex !== null) return draftIndex;\r\n      if (snapIndex !== null) return snapIndex;\r\n      return snap.officialIndex;\r\n    }\r\n\r\n    function ensureMotion(snap) {\r\n      if (!motionState) {\r\n        var initPct = pctFromIndex(currentShownIndex(snap), snap.count);\r\n        motionState = {\r\n          x: initPct,\r\n          v: 0,\r\n          a: 0,\r\n          target: initPct\r\n        };\r\n      }\r\n      return motionState;\r\n    }\r\n\r\n    function syncHeaderAndTrigger(snap, showIdx, visualPct) {\r\n      var count = snap.count;\r\n      var safeIdx = Math.max(0, Math.min(Math.max(0, count - 1), showIdx));\r\n      var levelItem = snap.levels[safeIdx];\r\n      var label = levelItem ? levelItem.label : \"\";\r\n      var isMax = !snap.locked && count > 1 && safeIdx === count - 1 && !isOffLevel(label);\r\n      var ringPct = typeof visualPct === \"number\" ? clamp01(visualPct) : pctFromIndex(safeIdx, count);\r\n      var ringEnergy = snap.locked ? 0 : energyForPct(ringPct, snap.energyStart);\r\n      var ringHex = snap.locked ? \"\" : valueColorFor(label, safeIdx, count, isMax, snap.hasOffFirst, snap.isClaude) || \"\";\r\n\r\n      var rowEl =\r\n        opts.row ||\r\n        (container.closest &&\r\n          (container.closest(\".ces-ag-effort-row\") ||\r\n            container.closest('[data-ces-effort-row=\"true\"]') ||\r\n            container.closest('[role=\"menuitem\"]')));\r\n\r\n      if (rowEl) {\r\n        if (rowEl.getAttribute(\"data-ces-effort-row\") !== \"true\") {\r\n          rowEl.setAttribute(\"data-ces-effort-row\", \"true\");\r\n        }\r\n        if (isMax) {\r\n          if (rowEl.getAttribute(\"data-ces-max\") !== \"true\") {\r\n            rowEl.setAttribute(\"data-ces-max\", \"true\");\r\n          }\r\n        } else if (rowEl.hasAttribute(\"data-ces-max\")) {\r\n          rowEl.removeAttribute(\"data-ces-max\");\r\n        }\r\n        applyRowRing(rowEl, ringHex, ringEnergy);\r\n      }\r\n\r\n      var valEl = opts.valueElement || (rowEl && findValueElement(rowEl));\r\n      if (valEl) {\r\n        if (label && valEl.textContent !== label) {\r\n          valEl.textContent = label;\r\n          // 无论是 Claude 还是 Codex (Argon / Flash)，文字切换时统一触发顺滑向上翻转动效\r\n          if (!prefersReducedMotion(win)) {\r\n            if (valEl.__cesRiseTimer) {\r\n              clearTimeout(valEl.__cesRiseTimer);\r\n              valEl.__cesRiseTimer = null;\r\n            }\r\n            valEl.classList.remove(\"ces-text-rise\");\r\n            valEl.classList.remove(\"is-claude-changing\");\r\n            void valEl.offsetWidth;\r\n            valEl.classList.add(\"ces-text-rise\");\r\n            valEl.classList.add(\"is-claude-changing\");\r\n            valEl.__cesRiseTimer = setTimeout(function () {\r\n              if (valEl && valEl.classList) {\r\n                valEl.classList.remove(\"ces-text-rise\");\r\n                valEl.classList.remove(\"is-claude-changing\");\r\n              }\r\n              valEl.__cesRiseTimer = null;\r\n            }, 320);\r\n          }\r\n        }\r\n        var vColor = snap.locked ? \"\" : valueColorFor(label, safeIdx, count, isMax, snap.hasOffFirst, snap.isClaude) || \"\";\r\n        if (valEl.style && valEl.style.color !== vColor) {\r\n          valEl.style.color = vColor;\r\n        }\r\n      }\r\n\r\n      syncTriggerColor(doc, label, safeIdx, count, isMax, snap.hasOffFirst, snap.isClaude);\r\n      if (typeof opts.onVisualChange === \"function\") {\r\n        try {\r\n          opts.onVisualChange({\r\n            index: safeIdx,\r\n            count: count,\r\n            label: label,\r\n            effort: levelItem ? levelItem.effort : \"\",\r\n            isMax: isMax,\r\n            locked: snap.locked\r\n          });\r\n        } catch (err) {\r\n          // 忽略外部视觉回调错误\r\n        }\r\n      }\r\n    }\r\n\r\n    function renderTicks(snap, effectivePct) {\r\n      var settings = readSettings(win);\r\n      var tickMode = settings.ticks || \"highlight\";\r\n      var count = snap.count;\r\n\r\n      if (tickMode === \"hidden\" || count <= 1) {\r\n        if (ticksEl.style.display !== \"none\") {\r\n          ticksEl.style.display = \"none\";\r\n        }\r\n        return;\r\n      }\r\n      if (ticksEl.style.display !== \"\") {\r\n        ticksEl.style.display = \"\";\r\n      }\r\n\r\n      if (lastRenderedTickCount !== count) {\r\n        ticksEl.innerHTML = \"\";\r\n        tickNodes = [];\r\n        for (var i = 0; i < count; i += 1) {\r\n          var tick = doc.createElement(\"span\");\r\n          tick.className = \"ces-tick\";\r\n          tick.setAttribute(\"data-ces-part\", \"tick\");\r\n          var tickPct = pctFromIndex(i, count);\r\n          tick.style.left = knobOffsetOf(tickPct, knobRadius);\r\n          ticksEl.appendChild(tick);\r\n          tickNodes.push({ el: tick, pct: tickPct });\r\n        }\r\n        lastRenderedTickCount = count;\r\n      }\r\n\r\n      for (var j = 0; j < tickNodes.length; j += 1) {\r\n        var node = tickNodes[j];\r\n        var reached = effectivePct + 1e-4 >= node.pct;\r\n        var nextTickClass = tickMode === \"dim\" ? \"ces-tick is-dim\" : reached ? \"ces-tick is-on\" : \"ces-tick\";\r\n        if (node.el.className !== nextTickClass) {\r\n          node.el.className = nextTickClass;\r\n        }\r\n      }\r\n    }\r\n\r\n    function stopClaudeCanvasAnimation() {\r\n      if (claudeRafId !== null && win && typeof win.cancelAnimationFrame === \"function\") {\r\n        win.cancelAnimationFrame(claudeRafId);\r\n      }\r\n      claudeRafId = null;\r\n    }\r\n\r\n    function stepClaudeCanvas(nowTs) {\r\n      claudeRafId = null;\r\n      if (destroyed) return;\r\n      var snap = readSeatSnapshot();\r\n      // 强度归零（回到 Low / 切走 Claude / 锁定）即停止循环，零冗余开销\r\n      if (!snap.isClaude || snap.locked || claudeIntensity <= 0) {\r\n        stopClaudeCanvasAnimation();\r\n        return;\r\n      }\r\n      var now = typeof nowTs === \"number\" && nowTs > 0 ? nowTs : nowMs();\r\n      var elapsed = Math.max(0, now - claudeAnimStart);\r\n      var progress = Math.min(1, elapsed / CLAUDE_SWEEP_MS);\r\n      // 相位按帧累加：dt 上限 50ms，防止切后台回来后一次性跳很远\r\n      var frameDt = claudeLastTs > 0 ? Math.min(0.05, Math.max(0, (now - claudeLastTs) / 1000)) : 0;\r\n      claudeLastTs = now;\r\n      claudeFlowTime += frameDt * claudeSpeed;\r\n      var isDark = surfaceIsDark(win, doc);\r\n      var rect = trackEl.getBoundingClientRect ? trackEl.getBoundingClientRect() : null;\r\n      var trackW = rect && rect.width > 0 ? rect.width : 280;\r\n      var th = rect && rect.height > 0 ? Math.round(rect.height) : (claudeCanvasEl.height || 28);\r\n      // 画布像素宽度 = 已填充宽度（圆钮中心），与 CSS width: var(--ces-fill) 对齐\r\n      var curPct = motionState ? clamp01(motionState.x) : 0;\r\n      var tw = Math.max(1, Math.round(knobRadius + (trackW - knobRadius * 2) * curPct));\r\n      if (claudeCanvasEl.width !== tw) claudeCanvasEl.width = tw;\r\n      if (claudeCanvasEl.height !== th) claudeCanvasEl.height = th;\r\n      var cctx = claudeCanvasEl.getContext && claudeCanvasEl.getContext(\"2d\");\r\n      if (cctx) {\r\n        paintDither(cctx, tw, th, isDark, progress, claudeFlowTime, claudeIntensity);\r\n      }\r\n      if (win && typeof win.requestAnimationFrame === \"function\") {\r\n        claudeRafId = win.requestAnimationFrame(stepClaudeCanvas);\r\n      }\r\n    }\r\n\r\n    function startClaudeCanvasAnimation() {\r\n      if (destroyed || claudeRafId !== null) return;\r\n      if (win && typeof win.requestAnimationFrame === \"function\") {\r\n        claudeRafId = win.requestAnimationFrame(stepClaudeCanvas);\r\n      } else {\r\n        stepClaudeCanvas(nowMs());\r\n      }\r\n    }\r\n\r\n    function applyVisualPct(snap, effectivePct, showIdx) {\r\n      var p = clamp01(effectivePct);\r\n      var count = snap.count;\r\n      var safeIdx = Math.max(0, Math.min(Math.max(0, count - 1), showIdx));\r\n      var levelItem = snap.levels[safeIdx];\r\n      var label = levelItem ? levelItem.label : \"\";\r\n\r\n      var theme = snap.theme || \"codex\";\r\n      if (rootEl.getAttribute(\"data-theme\") !== theme) rootEl.setAttribute(\"data-theme\", theme);\r\n      if (trackEl.getAttribute(\"data-theme\") !== theme) trackEl.setAttribute(\"data-theme\", theme);\r\n      if (container && container.setAttribute && container.getAttribute(\"data-theme\") !== theme) {\r\n        container.setAttribute(\"data-theme\", theme);\r\n      }\r\n\r\n      // 设为 -1，防止 Radix/Base UI FocusScope 在重新打开菜单时将焦点自动抢到推理条上导致框选\r\n      var nextTabIndex = \"-1\";\r\n      if (rootEl.getAttribute(\"tabindex\") !== nextTabIndex) rootEl.setAttribute(\"tabindex\", nextTabIndex);\r\n      if (rootEl.getAttribute(\"aria-valuemin\") !== \"0\") rootEl.setAttribute(\"aria-valuemin\", \"0\");\r\n      var nextValMax = String(Math.max(0, count - 1));\r\n      if (rootEl.getAttribute(\"aria-valuemax\") !== nextValMax) rootEl.setAttribute(\"aria-valuemax\", nextValMax);\r\n      var nextValNow = String(safeIdx);\r\n      if (rootEl.getAttribute(\"aria-valuenow\") !== nextValNow) rootEl.setAttribute(\"aria-valuenow\", nextValNow);\r\n      if (rootEl.getAttribute(\"aria-valuetext\") !== label) rootEl.setAttribute(\"aria-valuetext\", label);\r\n      var nextDisabled = snap.locked ? \"true\" : \"false\";\r\n      if (rootEl.getAttribute(\"aria-disabled\") !== nextDisabled) rootEl.setAttribute(\"aria-disabled\", nextDisabled);\r\n\r\n      if (snap.locked) {\r\n        if (!trackEl.classList.contains(\"is-locked\")) trackEl.classList.add(\"is-locked\");\r\n      } else if (trackEl.classList.contains(\"is-locked\")) {\r\n        trackEl.classList.remove(\"is-locked\");\r\n      }\r\n\r\n      var offsetCss = knobOffsetOf(p, knobRadius);\r\n      var fillBg = fillBackgroundFor(p, snap.energyStart, snap.energyEnd, snap.isClaude);\r\n      trackEl.style.setProperty(\"--ces-fill\", offsetCss);\r\n      trackEl.style.setProperty(\"--ces-fill-bg\", fillBg);\r\n      fillEl.style.width = offsetCss;\r\n      fillEl.style.background = fillBg;\r\n      energyEl.style.width = offsetCss;\r\n      starsEl.style.width = offsetCss;\r\n      knobEl.style.left = offsetCss;\r\n\r\n      // Claude 点阵：按圆钮实际位置连续计算强度/速度（Medium ≈0.35 强度、半速；High 全量、全速）\r\n      claudeIntensity = snap.isClaude && !snap.locked && count > 1 ? claudeIntensityFor(p, snap.energyStart) : 0;\r\n      claudeSpeed = claudeSpeedFor(p, snap.energyStart);\r\n      if (claudeIntensity > 0) {\r\n        if (claudeCanvasEl.style.display !== \"block\") {\r\n          // 仅「无特效 → 有特效」时重置入场扫掠；之后拖动只调强度/速度，不重播\r\n          claudeCanvasEl.style.display = \"block\";\r\n          claudeAnimStart = nowMs();\r\n          claudeLastTs = 0;\r\n        }\r\n        startClaudeCanvasAnimation();\r\n      } else {\r\n        if (claudeCanvasEl.style.display !== \"none\") {\r\n          claudeCanvasEl.style.display = \"none\";\r\n        }\r\n        stopClaudeCanvasAnimation();\r\n      }\r\n\r\n      var energy = snap.locked ? 0 : energyForPct(p, snap.energyStart);\r\n      var slowdown = motionMode(win) === \"quick\" ? REDUCED_MOTION_SLOWDOWN : 1;\r\n      if (Math.abs(energy - lastAppliedEnergy) > 1e-5 || slowdown !== lastAppliedSlowdown) {\r\n        lastAppliedEnergy = energy;\r\n        lastAppliedSlowdown = slowdown;\r\n\r\n        var energyOn = energy > 0 ? \"1\" : \"0\";\r\n        var energyStr = String(Math.round(energy * 1000) / 1000);\r\n        if (rootEl.getAttribute(\"data-energy\") !== energyOn) rootEl.setAttribute(\"data-energy\", energyOn);\r\n        rootEl.style.setProperty(\"--ces-energy\", energyStr);\r\n        if (container && container.setAttribute) {\r\n          if (container.getAttribute(\"data-energy\") !== energyOn) container.setAttribute(\"data-energy\", energyOn);\r\n          if (container.style) container.style.setProperty(\"--ces-energy\", energyStr);\r\n        }\r\n\r\n        var starLayerOpacity = starLayerOpacityFor(energy);\r\n        trackEl.style.setProperty(\"--ces-star-opacity\", String(starLayerOpacity));\r\n        starsEl.style.opacity = String(starLayerOpacity);\r\n\r\n        var visibleCount = Math.round(energy * PARTICLES.length);\r\n        var speedFactor = speedFor(p, snap.energyStart);\r\n        starsEl.setAttribute(\"data-count\", String(visibleCount));\r\n\r\n        for (var i = 0; i < starNodes.length; i += 1) {\r\n          var sNode = starNodes[i];\r\n          var dur = starDurationFor(i, speedFactor) * slowdown;\r\n          var delay = starDelayFor(i, dur);\r\n          sNode.el.style.display = i < visibleCount ? \"\" : \"none\";\r\n          sNode.el.style.animationDuration = dur.toFixed(3) + \"s\";\r\n          sNode.el.style.animationDelay = delay.toFixed(3) + \"s\";\r\n        }\r\n      }\r\n\r\n      renderTicks(snap, p);\r\n      syncHeaderAndTrigger(snap, safeIdx, p);\r\n    }\r\n\r\n    function stopFrames() {\r\n      if (rafId !== null && win && typeof win.cancelAnimationFrame === \"function\") {\r\n        win.cancelAnimationFrame(rafId);\r\n      }\r\n      rafId = null;\r\n      lastFrameMs = 0;\r\n    }\r\n\r\n    function stepFrame(ts) {\r\n      rafId = null;\r\n      if (destroyed) return;\r\n      var snap = readSeatSnapshot();\r\n      var m = ensureMotion(snap);\r\n      var mode = motionMode(win);\r\n      var params = motionParamsForMode(mode);\r\n\r\n      var now = typeof ts === \"number\" && ts > 0 ? ts : nowMs();\r\n      var dt = lastFrameMs > 0 ? (now - lastFrameMs) / 1000 : 1 / 60;\r\n      lastFrameMs = now;\r\n\r\n      motionStep(m, dt, params);\r\n      var showIdx = currentShownIndex(snap);\r\n      applyVisualPct(snap, m.x, showIdx);\r\n\r\n      if (!motionSettled(m, params)) {\r\n        startFrames();\r\n      } else {\r\n        m.x = clamp01(m.target);\r\n        m.v = 0;\r\n        m.a = 0;\r\n        if (!dragging) {\r\n          snapIndex = null;\r\n        }\r\n        applyVisualPct(snap, m.x, currentShownIndex(snap));\r\n      }\r\n    }\r\n\r\n    function startFrames() {\r\n      if (destroyed || rafId !== null) return;\r\n      if (win && typeof win.requestAnimationFrame === \"function\") {\r\n        rafId = win.requestAnimationFrame(stepFrame);\r\n      } else {\r\n        stepFrame(nowMs());\r\n      }\r\n    }\r\n\r\n    function clearMaxEffects() {\r\n      var rowEl =\r\n        opts.row ||\r\n        (container.closest &&\r\n          (container.closest(\".ces-ag-effort-row\") ||\r\n            container.closest('[data-ces-effort-row=\"true\"]')));\r\n      var valEl = opts.valueElement || findValueElement(rowEl);\r\n      if (valEl && valEl.classList && valEl.classList.contains(\"is-glowing\")) {\r\n        valEl.classList.remove(\"is-glowing\");\r\n        if (valEl.__cesGlowTimer) {\r\n          clearTimeout(valEl.__cesGlowTimer);\r\n          valEl.__cesGlowTimer = null;\r\n        }\r\n      }\r\n    }\r\n\r\n    function triggerMaxEffects(isClaude) {\r\n      if (prefersReducedMotion(win)) return;\r\n\r\n      // \"High\" 文字到达最高档时的模糊光斑爆散 (约 0.4s 淡淡消失)\r\n      var rowEl =\r\n        opts.row ||\r\n        (container.closest &&\r\n          (container.closest(\".ces-ag-effort-row\") ||\r\n            container.closest('[data-ces-effort-row=\"true\"]')));\r\n      var valEl = opts.valueElement || findValueElement(rowEl);\r\n      if (valEl && valEl.classList) {\r\n        var glowColor = isClaude ? \"rgba(196, 181, 253, 0.9)\" : \"rgba(168, 85, 247, 0.9)\";\r\n        if (valEl.style && typeof valEl.style.setProperty === \"function\") {\r\n          valEl.style.setProperty(\"--ces-glow-color\", glowColor);\r\n        }\r\n        valEl.classList.remove(\"is-glowing\");\r\n        void valEl.offsetWidth;\r\n        valEl.classList.add(\"is-glowing\");\r\n        if (valEl.__cesGlowTimer) {\r\n          clearTimeout(valEl.__cesGlowTimer);\r\n        }\r\n        valEl.__cesGlowTimer = setTimeout(function () {\r\n          if (valEl && valEl.classList) valEl.classList.remove(\"is-glowing\");\r\n          valEl.__cesGlowTimer = null;\r\n        }, 450);\r\n      }\r\n    }\r\n\r\n    /**\r\n     * 立即把目标档位写回宿主（Antigravity React Fiber 或 Seat）：\r\n     * 拖过档位边界时同步触发，无需等待 pointerup 松手。\r\n     */\r\n    function commitAtIndex(targetIndex, reason) {\r\n      var snap = readSeatSnapshot();\r\n      if (snap.locked || snap.count <= 1) return;\r\n      var clampedIdx = Math.max(0, Math.min(snap.count - 1, targetIndex));\r\n      var item = snap.levels[clampedIdx];\r\n      if (!item) return;\r\n\r\n      var isNowMax = clampedIdx === snap.count - 1 && !isOffLevel(item.label);\r\n      var wasMax = lastCommittedIndex === snap.count - 1;\r\n\r\n      lastCommittedIndex = clampedIdx;\r\n      tracePush(\"commit\", {\r\n        reason: reason || \"drag\",\r\n        index: clampedIdx,\r\n        effort: item.effort,\r\n        label: item.label\r\n      });\r\n\r\n      if (isNowMax && !wasMax) {\r\n        triggerMaxEffects(snap.isClaude);\r\n      } else if (!isNowMax && wasMax) {\r\n        clearMaxEffects();\r\n      }\r\n\r\n      if (seat && typeof seat.selectEffort === \"function\") {\r\n        try {\r\n          seat.selectEffort(item.raw !== undefined ? item.raw : item.effort, clampedIdx);\r\n        } catch (err) {\r\n          tracePush(\"commit-error\", { message: String(err && err.message ? err.message : err) });\r\n        }\r\n      }\r\n      if (typeof opts.onCommit === \"function\") {\r\n        try {\r\n          opts.onCommit(item, clampedIdx, reason || \"drag\");\r\n        } catch (err) {\r\n          // 忽略外部回调异常\r\n        }\r\n      }\r\n    }\r\n\r\n    function pctAtClientX(clientX) {\r\n      var rect = trackEl.getBoundingClientRect ? trackEl.getBoundingClientRect() : null;\r\n      if (!rect || !(rect.width > 0)) return null;\r\n      var usable = Math.max(1, rect.width - knobRadius * 2);\r\n      var raw = (clientX - rect.left - knobRadius) / usable;\r\n      return clamp01(raw);\r\n    }\r\n\r\n    function moveToClientX(clientX, isInitialDown) {\r\n      var snap = readSeatSnapshot();\r\n      if (snap.locked || snap.count <= 0) return;\r\n\r\n      var ptrPct = pctAtClientX(clientX);\r\n      if (ptrPct === null) ptrPct = pctFromIndex(snap.officialIndex, snap.count);\r\n\r\n      var now = nowMs();\r\n      if (lastPtrPct !== null && lastPtrMs > 0) {\r\n        var dt = (now - lastPtrMs) / 1000;\r\n        if (dt > 1e-4 && dt < 0.25) {\r\n          var instSpeed = (ptrPct - lastPtrPct) / dt;\r\n          ptrSpeed = ptrSpeed * (1 - POINTER_SPEED_EMA) + instSpeed * POINTER_SPEED_EMA;\r\n        }\r\n      } else {\r\n        ptrSpeed = 0;\r\n      }\r\n      lastPtrPct = ptrPct;\r\n      lastPtrMs = now;\r\n\r\n      var mode = motionMode(win);\r\n      var nowIndex;\r\n      var targetPct;\r\n\r\n      if (mode === \"fast\") {\r\n        if (isInitialDown || detentIndex < 0 || detentIndex >= snap.count) {\r\n          // 按下时若点击位置跨格，直接按最近格响应；随后的拖动按 1/3 边界迟滞棘轮触发\r\n          nowIndex = isInitialDown\r\n            ? indexFromPct(ptrPct, snap.count)\r\n            : detentTargetIndex(snap.officialIndex, ptrPct, snap.count);\r\n        } else {\r\n          nowIndex = detentTargetIndex(detentIndex, ptrPct, snap.count);\r\n        }\r\n        // 仅当指针已进入 nowIndex 自身的稳定死区时才把棘轮锚点推进到 nowIndex，\r\n        // 否则保持在过渡区来源侧相邻格，防止在 [1/3, 2/3] 区间连续微移或松手时来回翻转\r\n        if (detentTargetIndex(nowIndex, ptrPct, snap.count) === nowIndex) {\r\n          detentIndex = nowIndex;\r\n        } else if (ptrPct < pctFromIndex(nowIndex, snap.count)) {\r\n          detentIndex = Math.max(0, nowIndex - 1);\r\n        } else {\r\n          detentIndex = Math.min(snap.count - 1, nowIndex + 1);\r\n        }\r\n        targetPct = ptrPct;\r\n      } else {\r\n        nowIndex = indexFromPct(ptrPct, snap.count);\r\n        targetPct = ptrPct;\r\n      }\r\n\r\n      draftPct = ptrPct;\r\n      draftIndex = nowIndex;\r\n\r\n      var m = ensureMotion(snap);\r\n      m.target = targetPct;\r\n\r\n      // ★ 核心交互：只要滑过档位边界（或者点击了另一档位），不用等松手，立即切换官方真实档位 ★\r\n      if (nowIndex !== lastCommittedIndex) {\r\n        commitAtIndex(nowIndex, isInitialDown ? \"down\" : \"drag\");\r\n      }\r\n\r\n      // ★ 顺滑连续跟手：拖动中圆钮直接 1:1 跟随鼠标连续浮点位置，不卡顿、不硬吸附 ★\r\n      // 松手（endDrag）时再以 ~100ms 轻快阻尼磁吸至最终离散档位圆心\r\n      m.x = targetPct;\r\n      m.v = 0;\r\n      m.a = 0;\r\n      stopFrames();\r\n      applyVisualPct(readSeatSnapshot(), m.x, nowIndex);\r\n    }\r\n\r\n    function endDrag(clientX) {\r\n      if (!dragging) return;\r\n      var snap = readSeatSnapshot();\r\n      var ptrPct = draftPct !== null ? draftPct : pctFromIndex(snap.officialIndex, snap.count);\r\n      if (typeof clientX === \"number\") {\r\n        var p = pctAtClientX(clientX);\r\n        if (p !== null) ptrPct = p;\r\n      }\r\n\r\n      var mode = motionMode(win);\r\n      var finalIndex;\r\n      if (mode === \"fast\") {\r\n        var baseDetent = detentIndex >= 0 && detentIndex < snap.count ? detentIndex : snap.officialIndex;\r\n        finalIndex = detentTargetIndex(baseDetent, ptrPct, snap.count);\r\n      } else if (mode === \"quick\") {\r\n        finalIndex = indexFromPct(ptrPct, snap.count);\r\n      } else {\r\n        var idleS = lastPtrMs > 0 ? Math.max(0, (nowMs() - lastPtrMs) / 1000) : 1;\r\n        finalIndex = releaseIndexFor(ptrPct, ptrSpeed, idleS, snap.count);\r\n      }\r\n\r\n      dragging = false;\r\n      buttonDown = false;\r\n      draftPct = null;\r\n      draftIndex = null;\r\n      detentIndex = -1;\r\n      lastPtrPct = null;\r\n      ptrSpeed = 0;\r\n      snapIndex = finalIndex;\r\n\r\n      if (finalIndex !== lastCommittedIndex) {\r\n        commitAtIndex(finalIndex, \"release\");\r\n      }\r\n\r\n      var m = ensureMotion(snap);\r\n      m.target = pctFromIndex(finalIndex, snap.count);\r\n\r\n      if (mode === \"quick\") {\r\n        m.x = m.target;\r\n        m.v = 0;\r\n        m.a = 0;\r\n        snapIndex = null;\r\n        stopFrames();\r\n        applyVisualPct(readSeatSnapshot(), m.x, finalIndex);\r\n      } else {\r\n        m.x = ptrPct;\r\n        m.v = 0;\r\n        m.a = 0;\r\n        applyVisualPct(readSeatSnapshot(), m.x, finalIndex);\r\n        startFrames();\r\n      }\r\n    }\r\n\r\n    function swallowEvent(ev) {\r\n      if (!ev) return;\r\n      if (typeof ev.stopPropagation === \"function\") ev.stopPropagation();\r\n    }\r\n\r\n    function onPointerDown(ev) {\r\n      if (ev && typeof ev.button === \"number\" && ev.button !== 0) return;\r\n      var snap = readSeatSnapshot();\r\n      if (snap.locked || snap.count <= 1) return;\r\n      swallowEvent(ev);\r\n      if (typeof ev.preventDefault === \"function\") ev.preventDefault();\r\n\r\n      dragging = true;\r\n      buttonDown = true;\r\n      // 起手时对齐当前官方档位，若起手点就在当前档位则不重复触发无意义的写入；若点在其他档位则立即切过去\r\n      lastCommittedIndex = snap.officialIndex;\r\n      detentIndex = snap.officialIndex;\r\n      snapIndex = null;\r\n      lastPtrPct = null;\r\n\r\n      try {\r\n        if (trackEl.setPointerCapture && ev.pointerId !== undefined) {\r\n          trackEl.setPointerCapture(ev.pointerId);\r\n        }\r\n      } catch (err) {\r\n        // 忽略不支持 pointerCapture 的环境\r\n      }\r\n\r\n      moveToClientX(ev.clientX, true);\r\n    }\r\n\r\n    function onPointerMove(ev) {\r\n      if (!dragging) return;\r\n      if (ev && ev.buttons === 0 && !buttonDown) return;\r\n      swallowEvent(ev);\r\n      moveToClientX(ev.clientX, false);\r\n    }\r\n\r\n    function onPointerUp(ev) {\r\n      if (!dragging) return;\r\n      swallowEvent(ev);\r\n      buttonDown = false;\r\n      try {\r\n        if (trackEl.releasePointerCapture && ev && ev.pointerId !== undefined) {\r\n          trackEl.releasePointerCapture(ev.pointerId);\r\n        }\r\n      } catch (err) {\r\n        // 忽略释放失败\r\n      }\r\n      endDrag(ev && typeof ev.clientX === \"number\" ? ev.clientX : undefined);\r\n    }\r\n\r\n    function onPointerCancel(ev) {\r\n      if (!dragging) return;\r\n      swallowEvent(ev);\r\n      buttonDown = false;\r\n      endDrag(undefined);\r\n    }\r\n\r\n    function onKeyDown(ev) {\r\n      var snap = readSeatSnapshot();\r\n      if (snap.locked || snap.count <= 1) return;\r\n      var key = ev && ev.key;\r\n      var curIdx = currentShownIndex(snap);\r\n      var nextIdx = null;\r\n      if (key === \"ArrowLeft\" || key === \"ArrowDown\") {\r\n        nextIdx = Math.max(0, curIdx - 1);\r\n      } else if (key === \"ArrowRight\" || key === \"ArrowUp\") {\r\n        nextIdx = Math.min(snap.count - 1, curIdx + 1);\r\n      } else if (key === \"Home\") {\r\n        nextIdx = 0;\r\n      } else if (key === \"End\") {\r\n        nextIdx = snap.count - 1;\r\n      } else {\r\n        return;\r\n      }\r\n      swallowEvent(ev);\r\n      if (typeof ev.preventDefault === \"function\") ev.preventDefault();\r\n\r\n      snapIndex = nextIdx;\r\n      commitAtIndex(nextIdx, \"key\");\r\n      var m = ensureMotion(snap);\r\n      m.target = pctFromIndex(nextIdx, snap.count);\r\n\r\n      if (motionMode(win) === \"quick\") {\r\n        m.x = m.target;\r\n        m.v = 0;\r\n        m.a = 0;\r\n        snapIndex = null;\r\n        stopFrames();\r\n        applyVisualPct(readSeatSnapshot(), m.x, nextIdx);\r\n      } else {\r\n        applyVisualPct(readSeatSnapshot(), m.x, nextIdx);\r\n        startFrames();\r\n      }\r\n    }\r\n\r\n    // 阻断 click / mouseup 冒泡到外层 MenuItem，防止拖动松手时意外关闭官方菜单\r\n    function onBlockMenuClose(ev) {\r\n      swallowEvent(ev);\r\n    }\r\n\r\n    trackEl.addEventListener(\"pointerdown\", onPointerDown);\r\n    trackEl.addEventListener(\"pointermove\", onPointerMove);\r\n    trackEl.addEventListener(\"pointerup\", onPointerUp);\r\n    trackEl.addEventListener(\"pointercancel\", onPointerCancel);\r\n    trackEl.addEventListener(\"lostpointercapture\", onPointerCancel);\r\n    trackEl.addEventListener(\"click\", onBlockMenuClose);\r\n    trackEl.addEventListener(\"mouseup\", onBlockMenuClose);\r\n    rootEl.addEventListener(\"keydown\", onKeyDown);\r\n\r\n    function syncFromExternal() {\r\n      if (destroyed || dragging) return;\r\n      var snap = readSeatSnapshot();\r\n      var m = ensureMotion(snap);\r\n      var targetIdx = snap.officialIndex;\r\n      var targetPct = pctFromIndex(targetIdx, snap.count);\r\n      m.target = targetPct;\r\n\r\n      if (\r\n        snap.locked ||\r\n        motionMode(win) === \"quick\" ||\r\n        motionSettled(m, motionParamsForMode(motionMode(win)))\r\n      ) {\r\n        m.x = targetPct;\r\n        m.v = 0;\r\n        m.a = 0;\r\n        snapIndex = null;\r\n        stopFrames();\r\n        applyVisualPct(snap, m.x, targetIdx);\r\n      } else {\r\n        applyVisualPct(snap, m.x, targetIdx);\r\n        startFrames();\r\n      }\r\n    }\r\n\r\n    var offSeat =\r\n      seat && typeof seat.subscribe === \"function\"\r\n        ? seat.subscribe(function () {\r\n            syncFromExternal();\r\n          })\r\n        : function () {};\r\n\r\n    var offSettings = onSettingsChange(function () {\r\n      var snap = readSeatSnapshot();\r\n      var m = ensureMotion(snap);\r\n      applyVisualPct(snap, m.x, currentShownIndex(snap));\r\n    }, win);\r\n\r\n    // 首次同步渲染\r\n    var initSnap = readSeatSnapshot();\r\n    var initMotion = ensureMotion(initSnap);\r\n    initMotion.x = pctFromIndex(initSnap.officialIndex, initSnap.count);\r\n    initMotion.target = initMotion.x;\r\n    applyVisualPct(initSnap, initMotion.x, initSnap.officialIndex);\r\n\r\n    return {\r\n      unmount: function () {\r\n        destroyed = true;\r\n        stopFrames();\r\n        stopClaudeCanvasAnimation();\r\n        clearMaxEffects();\r\n        var rowEl =\r\n          opts.row ||\r\n          (container.closest &&\r\n            (container.closest(\".ces-ag-effort-row\") ||\r\n              container.closest('[data-ces-effort-row=\"true\"]')));\r\n        var valEl = opts.valueElement || findValueElement(rowEl);\r\n        if (valEl && valEl.__cesRiseTimer) {\r\n          clearTimeout(valEl.__cesRiseTimer);\r\n          valEl.__cesRiseTimer = null;\r\n        }\r\n        if (typeof offSeat === \"function\") offSeat();\r\n        if (typeof offSettings === \"function\") offSettings();\r\n        trackEl.removeEventListener(\"pointerdown\", onPointerDown);\r\n        trackEl.removeEventListener(\"pointermove\", onPointerMove);\r\n        trackEl.removeEventListener(\"pointerup\", onPointerUp);\r\n        trackEl.removeEventListener(\"pointercancel\", onPointerCancel);\r\n        trackEl.removeEventListener(\"lostpointercapture\", onPointerCancel);\r\n        trackEl.removeEventListener(\"click\", onBlockMenuClose);\r\n        trackEl.removeEventListener(\"mouseup\", onBlockMenuClose);\r\n        rootEl.removeEventListener(\"keydown\", onKeyDown);\r\n        if (rootEl.parentNode === container) {\r\n          container.removeChild(rootEl);\r\n        }\r\n      },\r\n      refresh: function () {\r\n        syncFromExternal();\r\n      }\r\n    };\r\n  }\r\n\r\n  // ── 通用菜单观察器（兼容预置「推理等级」行的 DOM 结构与独立预览页） ────────────\r\n  function installMenuObserver(options) {\r\n    var opts = options || {};\r\n    var doc = opts.document || (typeof document !== \"undefined\" ? document : null);\r\n    var win = opts.window || (doc && doc.defaultView) || (typeof window !== \"undefined\" ? window : globalRoot);\r\n    var onChange = typeof opts.onChange === \"function\" ? opts.onChange : function () {};\r\n    if (!doc || !doc.body) {\r\n      return { stop: function () {}, rescan: function () {}, getCurrent: function () { return null; } };\r\n    }\r\n\r\n    var current = null;\r\n    var observer = null;\r\n\r\n    function detach() {\r\n      if (!current) return;\r\n      var prev = current;\r\n      current = null;\r\n      try {\r\n        if (prev.container && prev.container.parentNode) {\r\n          prev.container.parentNode.removeChild(prev.container);\r\n        }\r\n        if (prev.row && prev.previousStyle) {\r\n          prev.row.style.height = prev.previousStyle.height;\r\n          prev.row.style.flexWrap = prev.previousStyle.flexWrap;\r\n          prev.row.style.paddingTop = prev.previousStyle.paddingTop;\r\n          prev.row.style.paddingBottom = prev.previousStyle.paddingBottom;\r\n        }\r\n      } catch (err) {\r\n        // 忽略清理异常\r\n      }\r\n      onChange(null);\r\n    }\r\n\r\n    function scan() {\r\n      // 若页面存在 Antigravity 原生模型面板，交由 installAntigravityObserver 接管\r\n      if (findAntigravityPanel(doc) || findAntigravityTrigger(doc)) return;\r\n\r\n      var row = findInferenceRow(doc);\r\n      if (!row) {\r\n        if (current) detach();\r\n        return;\r\n      }\r\n      if (current && current.row === row && current.container && row.contains(current.container)) {\r\n        return;\r\n      }\r\n      if (current) detach();\r\n\r\n      var previousStyle = {\r\n        height: row.style.height || \"\",\r\n        flexWrap: row.style.flexWrap || \"\",\r\n        paddingTop: row.style.paddingTop || \"\",\r\n        paddingBottom: row.style.paddingBottom || \"\"\r\n      };\r\n\r\n      row.setAttribute(\"data-ces-effort-row\", \"true\");\r\n      row.style.height = \"auto\";\r\n      row.style.flexWrap = \"wrap\";\r\n      row.style.paddingTop = \"8px\";\r\n      row.style.paddingBottom = \"8px\";\r\n\r\n      var valEl = findValueElement(row);\r\n      var host = doc.createElement(\"div\");\r\n      host.className = \"ces-inline\";\r\n      host.setAttribute(\"data-ces-part\", \"host\");\r\n      row.appendChild(host);\r\n\r\n      current = {\r\n        row: row,\r\n        container: host,\r\n        value: valEl ? (valEl.textContent || \"\").trim() : \"\",\r\n        previousStyle: previousStyle\r\n      };\r\n      onChange(current);\r\n    }\r\n\r\n    scan();\r\n    var MO = (win && win.MutationObserver) || (typeof MutationObserver === \"function\" ? MutationObserver : null);\r\n    if (typeof MO === \"function\") {\r\n      observer = new MO(function () {\r\n        scan();\r\n      });\r\n      observer.observe(doc.body, { childList: true, subtree: true });\r\n    }\r\n\r\n    return {\r\n      stop: function () {\r\n        if (observer) {\r\n          observer.disconnect();\r\n          observer = null;\r\n        }\r\n        detach();\r\n      },\r\n      rescan: scan,\r\n      getCurrent: function () {\r\n        return current;\r\n      }\r\n    };\r\n  }\r\n\r\n  // ── Antigravity 原生模型选择器深度桥接器 ───────────────────────────────────\r\n  function installAntigravityObserver(options) {\r\n    var opts = options || {};\r\n    var doc = opts.document || (typeof document !== \"undefined\" ? document : null);\r\n    var win = opts.window || (doc && doc.defaultView) || (typeof window !== \"undefined\" ? window : globalRoot);\r\n    if (!doc || !doc.body) {\r\n      return { stop: function () {}, rescan: function () {} };\r\n    }\r\n\r\n    installStyles(doc);\r\n\r\n    // 记录每个基础模型在当前会话最后选定的推理档位（默认跟随 selectedModel 或 medium）\r\n    var perModelEffortMap = new Map();\r\n    var activeMount = null;\r\n    var activePanel = null;\r\n    var activeSection = null;\r\n    var activeRow = null;\r\n    var activeValueEl = null;\r\n    var activeHostEl = null;\r\n    var activeSeatListeners = new Set();\r\n    var activeBaseOverride = null;\r\n    var activeModelOptionOverride = null;\r\n    var activeOverrideSince = 0;\r\n\r\n    function setActiveModelOverride(option, base) {\r\n      activeModelOptionOverride = option || null;\r\n      activeBaseOverride = base || null;\r\n      activeOverrideSince = Date.now();\r\n    }\r\n\r\n    function clearActiveModelOverride() {\r\n      activeModelOptionOverride = null;\r\n      activeBaseOverride = null;\r\n      activeOverrideSince = 0;\r\n    }\r\n    var observer = null;\r\n    var isInternalMutating = false;\r\n    var ignoreModelTriggerUntil = 0;\r\n\r\n    function markIgnoreModelTrigger() {\r\n      ignoreModelTriggerUntil = Date.now() + 500;\r\n    }\r\n\r\n    function shouldIgnoreModelTrigger() {\r\n      return Date.now() < ignoreModelTriggerUntil;\r\n    }\r\n\r\n    function onIgnoreModelTriggerCapture(ev) {\r\n      if (!shouldIgnoreModelTrigger() || !ev) return;\r\n      var t = ev.target;\r\n      if (!t || typeof t.closest !== \"function\") return;\r\n      if (t.closest(\".ces-ag-composer, .ces-root, .ces-ag-section, .ces-set\")) return;\r\n      if (!t.closest('[data-testid=\"model-selector-trigger\"], [data-testid=\"model-selector-panel\"], button[aria-label^=\"Select model\"]')) {\r\n        return;\r\n      }\r\n      if (typeof ev.stopImmediatePropagation === \"function\") ev.stopImmediatePropagation();\r\n      else if (typeof ev.stopPropagation === \"function\") ev.stopPropagation();\r\n      if (ev.cancelable && typeof ev.preventDefault === \"function\") ev.preventDefault();\r\n    }\r\n\r\n    if (typeof doc.addEventListener === \"function\") {\r\n      [\"pointerdown\", \"pointerup\", \"mousedown\", \"mouseup\", \"click\"].forEach(function (type) {\r\n        doc.addEventListener(type, onIgnoreModelTriggerCapture, true);\r\n      });\r\n    }\r\n\r\n    function notifySeatListeners() {\r\n      activeSeatListeners.forEach(function (fn) {\r\n        try {\r\n          fn();\r\n        } catch (err) {\r\n          // 忽略订阅者异常\r\n        }\r\n      });\r\n    }\r\n\r\n    function getLiveContext() {\r\n      var trigger = findAntigravityTrigger(doc);\r\n      var panel = findAntigravityPanel(doc);\r\n      return readAntigravityFiberContext(trigger || panel);\r\n    }\r\n\r\n    function getActiveProfile(ctx) {\r\n      if (!ctx) return null;\r\n      syncProxyEffort(ctx.conversationId);\r\n      var target = activeModelOptionOverride || activeBaseOverride || ctx.selectedModel;\r\n      return resolveModelEffortProfile(ctx, target, perModelEffortMap);\r\n    }\r\n\r\n    /**\r\n     * 立即同步更新：\r\n     * 1. 底部 Composer 折叠触发按钮的模型名与档位颜色\r\n     * 2. 展开菜单中每一行模型右侧的档位文字与颜色、以及选中态高亮\r\n     */\r\n    function syncAntigravityDomDecorations(ctx, activeProfile) {\r\n      if (!ctx) return;\r\n      var profile = activeProfile || getActiveProfile(ctx);\r\n      if (!profile) return;\r\n\r\n      if (!profile.locked && profile.baseName && profile.currentEffort) {\r\n        perModelEffortMap.set(profile.baseName, profile.currentEffort);\r\n      }\r\n\r\n      var count = profile.levels.length;\r\n      var idx = profile.currentIndex;\r\n      var isMax = !profile.locked && count > 1 && idx === count - 1 && !isOffLevel(profile.currentLabel);\r\n\r\n      // 1. 同步底部折叠按钮 (button[data-testid=\"model-selector-trigger\"])\r\n      var triggerBtn = findAntigravityTrigger(doc);\r\n      if (triggerBtn) {\r\n        var outerSpan = triggerBtn.querySelector(\"span.min-w-0\");\r\n        if (outerSpan) {\r\n          var allSpans = outerSpan.querySelectorAll(\"span\");\r\n          for (var sIdx = 1; sIdx < allSpans.length; sIdx += 1) {\r\n            if (allSpans[sIdx].parentNode === outerSpan) {\r\n              outerSpan.removeChild(allSpans[sIdx]);\r\n            }\r\n          }\r\n          var effortSpan = outerSpan.querySelector(\"span.opacity-70, [data-ces-part='trigger-effort']\");\r\n          // Third-party (proxy) models have no native effort suffix in the\r\n          // collapsed trigger; add one so the strength shows next to the name,\r\n          // mirroring native Gemini/Claude triggers.\r\n          if (!effortSpan && profile.proxy && !profile.locked && profile.currentLabel) {\r\n            effortSpan = doc.createElement(\"span\");\r\n            effortSpan.className = \"opacity-70\";\r\n            effortSpan.setAttribute(\"data-ces-part\", \"trigger-effort\");\r\n            outerSpan.appendChild(effortSpan);\r\n          }\r\n          if (!profile.locked && profile.baseName) {\r\n            var firstNode = outerSpan.firstChild;\r\n            if (firstNode && firstNode.nodeType === 3 && firstNode.nodeValue !== profile.baseName) {\r\n              firstNode.nodeValue = profile.baseName;\r\n            }\r\n            if (effortSpan) {\r\n              var nextEffortText = \" \" + profile.currentLabel;\r\n              if (effortSpan.textContent !== nextEffortText) {\r\n                effortSpan.textContent = nextEffortText;\r\n              }\r\n            }\r\n          }\r\n        }\r\n      }\r\n      syncTriggerColor(doc, profile.currentLabel, idx, count, isMax, false);\r\n\r\n      // 2. 同步展开菜单中的各模型行\r\n      var panel = findAntigravityPanel(doc);\r\n      if (!panel) return;\r\n\r\n      var groupSpans = panel.querySelectorAll('[data-testid=\"model-selector-effort-group\"]');\r\n      for (var i = 0; i < groupSpans.length; i += 1) {\r\n        var gSpan = groupSpans[i];\r\n        var base = gSpan.getAttribute(\"data-model-base\") || (gSpan.textContent || \"\").trim();\r\n        var menuItem = gSpan.closest('[role=\"menuitem\"]');\r\n        var rowProf = resolveModelEffortProfile(ctx, base, perModelEffortMap);\r\n        if (!rowProf) continue;\r\n\r\n        var isSelectedModel = profile.baseName === base;\r\n        if (menuItem) {\r\n          var nextSelectedAttr = isSelectedModel ? \"true\" : \"false\";\r\n          if (menuItem.getAttribute(\"data-ces-model-selected\") !== nextSelectedAttr) {\r\n            menuItem.setAttribute(\"data-ces-model-selected\", nextSelectedAttr);\r\n          }\r\n          if (isSelectedModel) {\r\n            if (menuItem.classList.contains(\"text-secondary-foreground\")) {\r\n              menuItem.classList.remove(\"text-secondary-foreground\");\r\n            }\r\n            if (!menuItem.classList.contains(\"text-foreground\")) {\r\n              menuItem.classList.add(\"text-foreground\");\r\n            }\r\n          } else {\r\n            if (menuItem.classList.contains(\"text-foreground\")) {\r\n              menuItem.classList.remove(\"text-foreground\");\r\n            }\r\n            if (!menuItem.classList.contains(\"text-secondary-foreground\")) {\r\n              menuItem.classList.add(\"text-secondary-foreground\");\r\n            }\r\n          }\r\n        }\r\n\r\n        // 模型名右侧的档位标签 (<span class=\"shrink-0 opacity-70 text-xs\">)\r\n        var sib = gSpan.nextElementSibling;\r\n        if (sib && sib.tagName === \"SPAN\") {\r\n          var displayEffort = isSelectedModel ? profile.currentLabel : rowProf.currentLabel;\r\n          var displayIdx = isSelectedModel ? profile.currentIndex : rowProf.currentIndex;\r\n          var displayCount = rowProf.levels.length;\r\n          var displayMax = displayCount > 1 && displayIdx === displayCount - 1;\r\n          if (sib.textContent !== displayEffort) {\r\n            sib.textContent = displayEffort;\r\n          }\r\n          var rowColor = valueColorFor(displayEffort, displayIdx, displayCount, displayMax, false) || \"\";\r\n          if (sib.style.color !== rowColor) sib.style.color = rowColor;\r\n          var rowOpacity = rowColor ? \"1\" : \"\";\r\n          if (sib.style.opacity !== rowOpacity) sib.style.opacity = rowOpacity;\r\n          var rowWeight = rowColor ? \"600\" : \"\";\r\n          if (sib.style.fontWeight !== rowWeight) sib.style.fontWeight = rowWeight;\r\n        }\r\n      }\r\n\r\n      var singleItems = panel.querySelectorAll('[data-testid=\"model-selector-item\"]');\r\n      for (var j = 0; j < singleItems.length; j += 1) {\r\n        var sItem = singleItems[j];\r\n        var sLabel = sItem.getAttribute(\"data-model-label\") || \"\";\r\n        var isSingleSelected =\r\n          (profile.modelOption && profile.modelOption.label === sLabel) ||\r\n          profile.baseName === sLabel;\r\n        var nextSingleAttr = isSingleSelected ? \"true\" : \"false\";\r\n        if (sItem.getAttribute(\"data-ces-model-selected\") !== nextSingleAttr) {\r\n          sItem.setAttribute(\"data-ces-model-selected\", nextSingleAttr);\r\n        }\r\n        if (isSingleSelected) {\r\n          if (sItem.classList.contains(\"text-secondary-foreground\")) {\r\n            sItem.classList.remove(\"text-secondary-foreground\");\r\n          }\r\n          if (!sItem.classList.contains(\"text-foreground\")) {\r\n            sItem.classList.add(\"text-foreground\");\r\n          }\r\n        } else {\r\n          if (sItem.classList.contains(\"text-foreground\")) {\r\n            sItem.classList.remove(\"text-foreground\");\r\n          }\r\n          if (!sItem.classList.contains(\"text-secondary-foreground\")) {\r\n            sItem.classList.add(\"text-secondary-foreground\");\r\n          }\r\n        }\r\n\r\n        // Third-party models render as single rows (no native effort group), so\r\n        // mirror the group-row decoration: show the proxy level to the right of\r\n        // the model name, colored like the native effort labels.\r\n        var singleProxy = proxyEffort.byBase.get(proxyBaseKey(sLabel));\r\n        if (singleProxy) {\r\n          var singleProf = resolveModelEffortProfile(ctx, sLabel, perModelEffortMap);\r\n          if (singleProf && singleProf.levels.length) {\r\n            var nameSpan = sItem.querySelector(\"span.truncate\");\r\n            var effortSpan = sItem.querySelector('[data-ces-part=\"single-effort\"]');\r\n            if (!effortSpan) {\r\n              effortSpan = doc.createElement(\"span\");\r\n              effortSpan.className = \"shrink-0 opacity-70 text-sm\";\r\n              effortSpan.setAttribute(\"data-ces-part\", \"single-effort\");\r\n              if (nameSpan && nameSpan.parentNode) {\r\n                nameSpan.parentNode.insertBefore(effortSpan, nameSpan.nextSibling);\r\n              } else {\r\n                sItem.appendChild(effortSpan);\r\n              }\r\n            }\r\n            var sEffort = isSingleSelected ? profile.currentLabel : singleProf.currentLabel;\r\n            var sIdx = isSingleSelected ? profile.currentIndex : singleProf.currentIndex;\r\n            var sCount = singleProf.levels.length;\r\n            var sMax = sCount > 1 && sIdx === sCount - 1;\r\n            if (effortSpan.textContent !== sEffort) effortSpan.textContent = sEffort;\r\n            var sColor = valueColorFor(sEffort, sIdx, sCount, sMax, false) || \"\";\r\n            if (effortSpan.style.color !== sColor) effortSpan.style.color = sColor;\r\n            var sOpacity = sColor ? \"1\" : \"\";\r\n            if (effortSpan.style.opacity !== sOpacity) effortSpan.style.opacity = sOpacity;\r\n            var sWeight = sColor ? \"600\" : \"\";\r\n            if (effortSpan.style.fontWeight !== sWeight) effortSpan.style.fontWeight = sWeight;\r\n          }\r\n        }\r\n      }\r\n    }\r\n\r\n    var agSeatAdapter = {\r\n      get effortLevels() {\r\n        var ctx = getLiveContext();\r\n        var prof = getActiveProfile(ctx);\r\n        return prof ? prof.levels : [];\r\n      },\r\n      get currentEffort() {\r\n        var ctx = getLiveContext();\r\n        var prof = getActiveProfile(ctx);\r\n        return prof ? prof.currentEffort : \"\";\r\n      },\r\n      get locked() {\r\n        var ctx = getLiveContext();\r\n        var prof = getActiveProfile(ctx);\r\n        return prof ? prof.locked : true;\r\n      },\r\n      get baseName() {\r\n        var ctx = getLiveContext();\r\n        var prof = getActiveProfile(ctx);\r\n        return prof ? prof.baseName : \"\";\r\n      },\r\n      get isClaude() {\r\n        var ctx = getLiveContext();\r\n        var prof = getActiveProfile(ctx);\r\n        return prof ? Boolean(prof.isClaude) : false;\r\n      },\r\n      get theme() {\r\n        var ctx = getLiveContext();\r\n        var prof = getActiveProfile(ctx);\r\n        return prof ? (prof.theme || \"codex\") : \"codex\";\r\n      },\r\n      selectEffort: function (levelItem) {\r\n        var ctx = getLiveContext();\r\n        if (!ctx || !levelItem) return;\r\n        var targetOpt = levelItem.modelOption || (levelItem.raw && levelItem.raw.modelOption);\r\n        var effortKey = levelItem.effort || (levelItem.raw && levelItem.raw.effort);\r\n        var proxyBase = levelItem.proxyBase || (levelItem.raw && levelItem.raw.proxyBase);\r\n        // 代理档位：不切换模型，只把档位写回代理（按会话生效）。\r\n        if (proxyBase && effortKey) {\r\n          var proxyModel = levelItem.proxyModel || (levelItem.raw && levelItem.raw.proxyModel);\r\n          perModelEffortMap.set(proxyBase, effortKey);\r\n          setActiveModelOverride(null, proxyBase);\r\n          pushProxyEffort({ name: proxyModel, displayName: proxyBase }, effortKey, ctx.conversationId);\r\n          isInternalMutating = true;\r\n          try {\r\n            syncAntigravityDomDecorations(ctx, resolveModelEffortProfile(ctx, proxyBase, perModelEffortMap));\r\n            notifySeatListeners();\r\n          } finally {\r\n            isInternalMutating = false;\r\n          }\r\n          return;\r\n        }\r\n        if (!targetOpt) return;\r\n\r\n        var parsed = parseModelLabel(targetOpt.label);\r\n        if (parsed) {\r\n          perModelEffortMap.set(parsed.base, parsed.effort);\r\n        }\r\n        setActiveModelOverride(targetOpt, parsed ? parsed.base : targetOpt.label);\r\n\r\n        markIgnoreModelTrigger();\r\n        commitAntigravityModelOption(ctx, targetOpt, { keepMenuOpen: false });\r\n        try {\r\n          setTimeout(function () {\r\n            syncModelMenuOpen(getLiveContext() || ctx, false);\r\n          }, 0);\r\n        } catch (err) {\r\n          // 忽略延迟关菜单失败\r\n        }\r\n\r\n        isInternalMutating = true;\r\n        try {\r\n          var updatedProfile = resolveModelEffortProfile(ctx, targetOpt, perModelEffortMap);\r\n          syncAntigravityDomDecorations(ctx, updatedProfile);\r\n        } finally {\r\n          isInternalMutating = false;\r\n        }\r\n      },\r\n      subscribe: function (fn) {\r\n        activeSeatListeners.add(fn);\r\n        return function () {\r\n          activeSeatListeners.delete(fn);\r\n        };\r\n      }\r\n    };\r\n\r\n    function bindPanelInteractions(panel) {\r\n      if (!panel || panel.__cesAgBound) return;\r\n      panel.__cesAgBound = true;\r\n\r\n      function findClickedModelRow(target) {\r\n        if (!target || typeof target.closest !== \"function\") return null;\r\n        if (target.closest(\".ces-ag-section, .ces-set\")) return null;\r\n        if (target.closest('button[aria-label=\"Edit Model\"]')) return null;\r\n\r\n        var singleRow = target.closest('[data-testid=\"model-selector-item\"]');\r\n        if (singleRow && panel.contains(singleRow)) {\r\n          return { type: \"single\", row: singleRow, label: singleRow.getAttribute(\"data-model-label\") || \"\" };\r\n        }\r\n\r\n        var menuItem = target.closest('[role=\"menuitem\"]');\r\n        if (!menuItem || !panel.contains(menuItem)) return null;\r\n        var groupSpan = menuItem.querySelector('[data-testid=\"model-selector-effort-group\"]');\r\n        if (groupSpan) {\r\n          var base = groupSpan.getAttribute(\"data-model-base\") || (groupSpan.textContent || \"\").trim();\r\n          return { type: \"group\", row: menuItem, base: base };\r\n        }\r\n        // Models without native effort variants (all third-party models) are\r\n        // single rows: their label lives on the menuitem itself.\r\n        var singleLabel = menuItem.getAttribute(\"data-model-label\") || \"\";\r\n        if (singleLabel) {\r\n          return { type: \"single\", row: menuItem, label: singleLabel };\r\n        }\r\n        return null;\r\n      }\r\n\r\n      // 捕获阶段拦截模型行 pointerup / mouseup，阻止 @base-ui/react 菜单在指针抬起阶段就先行关闭；\r\n      // 菜单统一在随后的 click 阶段完成模型切换后再收起，避免面板提前卸载导致切换丢失\r\n      function onPointerOrMouseUpCapture(ev) {\r\n        if (ev.target && typeof ev.target.closest === \"function\" && ev.target.closest(\".ces-ag-section\")) {\r\n          return;\r\n        }\r\n        var hit = findClickedModelRow(ev.target);\r\n        if (!hit) return;\r\n        ev.stopPropagation();\r\n        if (typeof ev.stopImmediatePropagation === \"function\") ev.stopImmediatePropagation();\r\n      }\r\n\r\n      // 捕获阶段拦截模型行 click：切换选中模型后按下拉栏原生行为收起菜单，\r\n      // 下方滑条仍会即时联动该模型的档位（菜单收起后再打开即可看到最新档位）\r\n      function onClickCapture(ev) {\r\n        if (ev.target && typeof ev.target.closest === \"function\" && ev.target.closest(\".ces-ag-section\")) {\r\n          return;\r\n        }\r\n        var hit = findClickedModelRow(ev.target);\r\n        if (!hit) return;\r\n\r\n        ev.preventDefault();\r\n        ev.stopPropagation();\r\n        if (typeof ev.stopImmediatePropagation === \"function\") ev.stopImmediatePropagation();\r\n\r\n        var ctx = getLiveContext();\r\n        if (!ctx) return;\r\n\r\n        var targetOption = null;\r\n        if (hit.type === \"group\" && hit.base) {\r\n          var prof = resolveModelEffortProfile(ctx, hit.base, perModelEffortMap);\r\n          if (prof && prof.modelOption) {\r\n            targetOption = prof.modelOption;\r\n            setActiveModelOverride(targetOption, hit.base);\r\n          }\r\n        } else if (hit.type === \"single\" && hit.label) {\r\n          var optsList = Array.isArray(ctx.modelOptions) ? ctx.modelOptions : [];\r\n          for (var i = 0; i < optsList.length; i += 1) {\r\n            if (optsList[i] && optsList[i].label === hit.label) {\r\n              targetOption = optsList[i];\r\n              break;\r\n            }\r\n          }\r\n          if (targetOption) {\r\n            setActiveModelOverride(targetOption, hit.label);\r\n          }\r\n        }\r\n\r\n        if (targetOption) {\r\n          tracePush(\"ag-select-model-in-menu\", { label: targetOption.label });\r\n          // 【ces-menu-autoclose】选中模型后收起模型下拉栏（恢复官方原生行为）。\r\n          // keepMenuOpen:false -> commitAntigravityModelOption 内部调用 syncModelMenuOpen(false)；\r\n          // 下一帧再用最新 context 确认一次，防止宿主同步渲染把面板重新打开。\r\n          markIgnoreModelTrigger();\r\n          commitAntigravityModelOption(ctx, targetOption, { keepMenuOpen: false });\r\n          try {\r\n            setTimeout(function () {\r\n              syncModelMenuOpen(getLiveContext() || ctx, false);\r\n            }, 0);\r\n          } catch (err) {\r\n            // 忽略延迟关菜单失败\r\n          }\r\n          isInternalMutating = true;\r\n          try {\r\n            var nextProf = resolveModelEffortProfile(ctx, targetOption, perModelEffortMap);\r\n            syncAntigravityDomDecorations(ctx, nextProf);\r\n            notifySeatListeners();\r\n          } finally {\r\n            isInternalMutating = false;\r\n          }\r\n        }\r\n      }\r\n\r\n      // 拦截 View Usage 触发项的划过展开，增加 0.3s (300ms) 停留防误触展开延迟\r\n      var usageHoverTimer = null;\r\n      var usageTriggerEl = null;\r\n      var usageHoverAllowed = false;\r\n      var isDispatchingSynthetic = false;\r\n\r\n      function findViewUsageTrigger(target) {\r\n        if (!target || typeof target.closest !== \"function\") return null;\r\n        var item = target.closest('[role=\"menuitem\"], .agy-overlay-item, button');\r\n        if (!item) {\r\n          var div = target.closest('div');\r\n          if (div && div !== panel && panel.contains(div)) {\r\n            var text = (div.textContent || \"\").trim();\r\n            if ((text.startsWith(\"View Usage\") || text === \"Usage\") && !text.includes(\"Claude\") && !text.includes(\"Gemini\") && !text.includes(\"GPT\")) {\r\n              item = div;\r\n            }\r\n          }\r\n        }\r\n        if (!item || !panel.contains(item) || item === panel) return null;\r\n        var itemText = (item.textContent || \"\").trim();\r\n        if (itemText.includes(\"View Usage\") || itemText.includes(\"Usage\")) {\r\n          return item;\r\n        }\r\n        return null;\r\n      }\r\n\r\n      function resetUsageHover() {\r\n        if (usageHoverTimer) {\r\n          clearTimeout(usageHoverTimer);\r\n          usageHoverTimer = null;\r\n        }\r\n        usageHoverAllowed = false;\r\n        usageTriggerEl = null;\r\n      }\r\n\r\n      function onTriggerLeave() {\r\n        resetUsageHover();\r\n      }\r\n\r\n      function onPointerEnterCapture(ev) {\r\n        if (isDispatchingSynthetic) return;\r\n\r\n        var trigger = findViewUsageTrigger(ev.target);\r\n        if (!trigger) {\r\n          resetUsageHover();\r\n          return;\r\n        }\r\n\r\n        if (usageHoverAllowed && usageTriggerEl === trigger) {\r\n          return;\r\n        }\r\n\r\n        ev.stopPropagation();\r\n        if (typeof ev.stopImmediatePropagation === \"function\") ev.stopImmediatePropagation();\r\n\r\n        resetUsageHover();\r\n        usageTriggerEl = trigger;\r\n\r\n        // 直接在目标元素上注册离开监听（W3C 规范：pointerleave 仅在离开该元素时触发且不冒泡）\r\n        try {\r\n          trigger.addEventListener(\"pointerleave\", onTriggerLeave, { once: true });\r\n          trigger.addEventListener(\"mouseleave\", onTriggerLeave, { once: true });\r\n        } catch (e) {}\r\n\r\n        var clientX = ev.clientX;\r\n        var clientY = ev.clientY;\r\n        var pointerId = ev.pointerId || 1;\r\n        var pointerType = ev.pointerType || \"mouse\";\r\n\r\n        usageHoverTimer = setTimeout(function () {\r\n          usageHoverTimer = null;\r\n          if (trigger && panel.contains(trigger)) {\r\n            usageHoverAllowed = true;\r\n            isDispatchingSynthetic = true;\r\n            try {\r\n              var PE = (win && win.PointerEvent) || (typeof PointerEvent !== \"undefined\" ? PointerEvent : null);\r\n              var ME = (win && win.MouseEvent) || (typeof MouseEvent !== \"undefined\" ? MouseEvent : null);\r\n              var EV = (win && win.Event) || (typeof Event !== \"undefined\" ? Event : null);\r\n\r\n              if (typeof PE === \"function\") {\r\n                trigger.dispatchEvent(new PE(\"pointerenter\", {\r\n                  bubbles: false,\r\n                  cancelable: true,\r\n                  pointerId: pointerId,\r\n                  pointerType: pointerType,\r\n                  clientX: clientX,\r\n                  clientY: clientY\r\n                }));\r\n                trigger.dispatchEvent(new PE(\"pointerover\", {\r\n                  bubbles: true,\r\n                  cancelable: true,\r\n                  pointerId: pointerId,\r\n                  pointerType: pointerType,\r\n                  clientX: clientX,\r\n                  clientY: clientY\r\n                }));\r\n                trigger.dispatchEvent(new PE(\"pointermove\", {\r\n                  bubbles: true,\r\n                  cancelable: true,\r\n                  pointerId: pointerId,\r\n                  pointerType: pointerType,\r\n                  clientX: clientX,\r\n                  clientY: clientY\r\n                }));\r\n              } else if (typeof ME === \"function\") {\r\n                trigger.dispatchEvent(new ME(\"mouseenter\", {\r\n                  bubbles: false,\r\n                  cancelable: true,\r\n                  clientX: clientX,\r\n                  clientY: clientY\r\n                }));\r\n              } else if (typeof EV === \"function\") {\r\n                trigger.dispatchEvent(new EV(\"pointerenter\", { bubbles: false, cancelable: true }));\r\n              }\r\n            } catch (err) {\r\n              // 忽略派发失败\r\n            } finally {\r\n              isDispatchingSynthetic = false;\r\n            }\r\n          }\r\n        }, 300);\r\n      }\r\n\r\n      function onPointerOverCapture(ev) {\r\n        if (isDispatchingSynthetic) return;\r\n        var trigger = findViewUsageTrigger(ev.target);\r\n        if (!trigger) {\r\n          // 鼠标移动到模型项或其它非 View Usage 元素，立即重置延迟状态\r\n          if (usageHoverAllowed || usageHoverTimer) {\r\n            resetUsageHover();\r\n          }\r\n          return;\r\n        }\r\n        if (!usageHoverAllowed) {\r\n          ev.stopPropagation();\r\n          if (typeof ev.stopImmediatePropagation === \"function\") ev.stopImmediatePropagation();\r\n        }\r\n      }\r\n\r\n      function onPointerOutCapture(ev) {\r\n        if (isDispatchingSynthetic) return;\r\n        var trigger = findViewUsageTrigger(ev.target);\r\n        if (trigger) {\r\n          var rel = ev.relatedTarget;\r\n          // 若相关目标已不在当前 trigger 内部，说明鼠标已移出 View Usage\r\n          if (!rel || !trigger.contains(rel)) {\r\n            resetUsageHover();\r\n          }\r\n        }\r\n      }\r\n\r\n      function onPointerMoveCapture(ev) {\r\n        if (isDispatchingSynthetic) return;\r\n        var trigger = findViewUsageTrigger(ev.target);\r\n        if (trigger && !usageHoverAllowed) {\r\n          ev.stopPropagation();\r\n          if (typeof ev.stopImmediatePropagation === \"function\") ev.stopImmediatePropagation();\r\n        }\r\n      }\r\n\r\n      function onPointerLeaveCapture(ev) {\r\n        // panel 自身的 pointerleave，或鼠标彻底移出面板\r\n        var rel = ev.relatedTarget;\r\n        if (!rel || !panel.contains(rel)) {\r\n          resetUsageHover();\r\n        }\r\n      }\r\n\r\n      panel.addEventListener(\"pointerenter\", onPointerEnterCapture, true);\r\n      panel.addEventListener(\"pointerover\", onPointerOverCapture, true);\r\n      panel.addEventListener(\"pointerout\", onPointerOutCapture, true);\r\n      panel.addEventListener(\"pointerleave\", onPointerLeaveCapture, true);\r\n      panel.addEventListener(\"pointermove\", onPointerMoveCapture, true);\r\n      panel.addEventListener(\"pointerup\", onPointerOrMouseUpCapture, true);\r\n      panel.addEventListener(\"mouseup\", onPointerOrMouseUpCapture, true);\r\n      panel.addEventListener(\"click\", onClickCapture, true);\r\n\r\n      panel.__cesAgResetUsageHover = resetUsageHover;\r\n    }\r\n\r\n    function unmountActiveSection() {\r\n      if (activePanel && typeof activePanel.__cesAgResetUsageHover === \"function\") {\r\n        try {\r\n          activePanel.__cesAgResetUsageHover();\r\n        } catch (e) {}\r\n      }\r\n      if (doc && doc.activeElement && activeSection && activeSection.contains(doc.activeElement)) {\r\n        try {\r\n          doc.activeElement.blur();\r\n        } catch (e) {}\r\n      }\r\n      if (activeMount) {\r\n        activeMount.unmount();\r\n        activeMount = null;\r\n      }\r\n      if (activeSection && activeSection.parentNode) {\r\n        activeSection.parentNode.removeChild(activeSection);\r\n      }\r\n      activeSection = null;\r\n      activeRow = null;\r\n      activeValueEl = null;\r\n      activeHostEl = null;\r\n      activePanel = null;\r\n      activeBaseOverride = null;\r\n      activeModelOptionOverride = null;\r\n    }\r\n\r\n    function stopComposerChromeEvents(ev) {\r\n      if (!ev) return;\r\n      markIgnoreModelTrigger();\r\n      if (typeof ev.stopImmediatePropagation === \"function\") ev.stopImmediatePropagation();\r\n      else if (typeof ev.stopPropagation === \"function\") ev.stopPropagation();\r\n    }\r\n\r\n    function mountSectionIntoComposer(permTrigger, ctx) {\r\n      var section = doc.createElement(\"div\");\r\n      section.className = \"ces-ag-section ces-ag-composer\";\r\n      section.setAttribute(\"data-ces-part\", \"ag-section\");\r\n      section.setAttribute(\"data-ces-composer\", \"true\");\r\n      [\"pointerdown\", \"pointerup\", \"pointermove\", \"pointercancel\", \"mousedown\", \"mouseup\", \"click\", \"dblclick\", \"touchstart\", \"touchend\"].forEach(function (type) {\r\n        section.addEventListener(type, stopComposerChromeEvents);\r\n      });\r\n\r\n      var row = doc.createElement(\"div\");\r\n      row.className = \"ces-ag-effort-row text-foreground\";\r\n      row.setAttribute(\"data-ces-effort-row\", \"true\");\r\n\r\n      var head = doc.createElement(\"div\");\r\n      head.className = \"ces-ag-effort-head\";\r\n\r\n      var title = doc.createElement(\"span\");\r\n      title.className = \"ces-ag-effort-title\";\r\n      title.textContent = \"推理等级\";\r\n\r\n      var valueEl = doc.createElement(\"span\");\r\n      valueEl.className = \"ces-ag-effort-value\";\r\n      valueEl.setAttribute(\"data-ces-part\", \"value\");\r\n      var initProf = getActiveProfile(ctx);\r\n      if (initProf && initProf.currentLabel) {\r\n        valueEl.textContent = initProf.currentLabel;\r\n      }\r\n\r\n      head.appendChild(title);\r\n      head.appendChild(valueEl);\r\n      row.appendChild(head);\r\n\r\n      var hostEl = doc.createElement(\"div\");\r\n      hostEl.className = \"ces-inline\";\r\n      hostEl.setAttribute(\"data-ces-part\", \"host\");\r\n      row.appendChild(hostEl);\r\n\r\n      section.appendChild(row);\r\n\r\n      var parent = permTrigger.parentNode;\r\n      if (parent && typeof parent.insertBefore === \"function\") {\r\n        parent.insertBefore(section, permTrigger);\r\n      } else if (parent && typeof parent.appendChild === \"function\") {\r\n        parent.appendChild(section);\r\n      }\r\n\r\n      activePanel = findAntigravityPanel(doc);\r\n      activeSection = section;\r\n      activeRow = row;\r\n      activeValueEl = valueEl;\r\n      activeHostEl = hostEl;\r\n\r\n      activeMount = mountCodexEffortSlider({\r\n        container: hostEl,\r\n        panel: activePanel,\r\n        row: row,\r\n        valueElement: valueEl,\r\n        seat: agSeatAdapter,\r\n        compact: true,\r\n        document: doc,\r\n        window: win,\r\n        onVisualChange: function (vState) {\r\n          isInternalMutating = true;\r\n          try {\r\n            var liveCtx = getLiveContext();\r\n            if (liveCtx) {\r\n              syncAntigravityDomDecorations(liveCtx, getActiveProfile(liveCtx));\r\n            } else {\r\n              syncTriggerColor(doc, vState.label, vState.index, vState.count, vState.isMax, false);\r\n            }\r\n          } finally {\r\n            isInternalMutating = false;\r\n          }\r\n        }\r\n      });\r\n\r\n      try {\r\n        if (win && typeof win.dispatchEvent === \"function\" && typeof win.Event === \"function\") {\r\n          win.dispatchEvent(new win.Event(\"resize\"));\r\n        }\r\n      } catch (err) {\r\n        // 忽略 resize 触发失败\r\n      }\r\n    }\r\n\r\n    function ensureComposerSection(ctx) {\r\n      var perm = findPermissionsTrigger(doc);\r\n      if (!perm || !perm.parentNode) {\r\n        if (activeSection && !nodeIsConnected(activeSection, doc)) {\r\n          unmountActiveSection();\r\n        }\r\n        return;\r\n      }\r\n\r\n      if (activeSection && nodeIsConnected(activeSection, doc) && activeSection.parentNode === perm.parentNode) {\r\n        if (activeSection.nextElementSibling !== perm && typeof perm.parentNode.insertBefore === \"function\") {\r\n          perm.parentNode.insertBefore(activeSection, perm);\r\n        }\r\n        return;\r\n      }\r\n\r\n      unmountActiveSection();\r\n      mountSectionIntoComposer(perm, ctx);\r\n    }\r\n\r\n    function scan() {\r\n      if (isInternalMutating) return;\r\n      isInternalMutating = true;\r\n      try {\r\n        var ctx = getLiveContext();\r\n        var panel = findAntigravityPanel(doc);\r\n\r\n        if (panel) {\r\n          if (panel.classList && typeof panel.classList.add === \"function\") {\r\n            panel.classList.add(\"ces-ag-panel-enhanced\");\r\n          }\r\n          bindPanelInteractions(panel);\r\n        }\r\n\r\n        // Temporary overrides only exist between a click and the host applying it.\r\n        // Drop them once the host selection confirms them, and also when the\r\n        // host moved to a different model by another path (single-row models\r\n        // are switched by the native menu handler), so the slider can never\r\n        // keep showing the previous model's levels.\r\n        if (ctx && ctx.selectedModel) {\r\n          var selectedParsed = parseModelLabel(ctx.selectedModel.label);\r\n          var selectedBase = selectedParsed ? selectedParsed.base : ctx.selectedModel.label || \"\";\r\n          var overrideParsed = activeModelOptionOverride ? parseModelLabel(activeModelOptionOverride.label) : null;\r\n          var overrideBase = overrideParsed ? overrideParsed.base : activeModelOptionOverride ? activeModelOptionOverride.label || \"\" : \"\";\r\n          if (activeModelOptionOverride && selectedBase === overrideBase) {\r\n            clearActiveModelOverride();\r\n          } else if (\r\n            activeModelOptionOverride &&\r\n            selectedBase !== activeBaseOverride &&\r\n            Date.now() - activeOverrideSince > 1200\r\n          ) {\r\n            clearActiveModelOverride();\r\n          }\r\n        }\r\n\r\n        ensureComposerSection(ctx);\r\n\r\n        if (shouldIgnoreModelTrigger() && ctx) {\r\n          syncModelMenuOpen(ctx, false);\r\n        }\r\n\r\n        if (ctx) {\r\n          syncAntigravityDomDecorations(ctx, getActiveProfile(ctx));\r\n        }\r\n        notifySeatListeners();\r\n      } finally {\r\n        isInternalMutating = false;\r\n      }\r\n    }\r\n\r\n    scan();\r\n    var MO = (win && win.MutationObserver) || (typeof MutationObserver === \"function\" ? MutationObserver : null);\r\n    if (typeof MO === \"function\") {\r\n      observer = new MO(function () {\r\n        scan();\r\n      });\r\n      observer.observe(doc.body, {\r\n        childList: true,\r\n        subtree: true,\r\n        characterData: true\r\n      });\r\n    }\r\n\r\n    // 代理档位是异步取回的：到达后立即重绘，面板静置时也保持低频刷新。\r\n    var onProxyEffortChange = function () {\r\n      try {\r\n        scan();\r\n      } catch (err) {\r\n        // 忽略重绘异常\r\n      }\r\n    };\r\n    proxyEffort.listeners.add(onProxyEffortChange);\r\n    var proxyTimer = null;\r\n    if (win && typeof win.setInterval === \"function\") {\r\n      proxyTimer = win.setInterval(function () {\r\n        var liveCtx = getLiveContext();\r\n        if (liveCtx) syncProxyEffort(liveCtx.conversationId);\r\n      }, AG_PROXY_SYNC_INTERVAL_MS);\r\n    }\r\n\r\n    return {\r\n      stop: function () {\r\n        proxyEffort.listeners.delete(onProxyEffortChange);\r\n        if (proxyTimer !== null && win && typeof win.clearInterval === \"function\") {\r\n          win.clearInterval(proxyTimer);\r\n          proxyTimer = null;\r\n        }\r\n        if (observer) {\r\n          observer.disconnect();\r\n          observer = null;\r\n        }\r\n        if (typeof doc.removeEventListener === \"function\") {\r\n          [\"pointerdown\", \"pointerup\", \"mousedown\", \"mouseup\", \"click\"].forEach(function (type) {\r\n            doc.removeEventListener(type, onIgnoreModelTriggerCapture, true);\r\n          });\r\n        }\r\n        unmountActiveSection();\r\n      },\r\n      rescan: scan,\r\n      bindPanelInteractions: bindPanelInteractions\r\n    };\r\n  }\r\n\r\n  // ── 一键安装到当前窗口（同时兼容 Antigravity 原生环境与 Seat 预览环境） ────────\r\n  function installCodexEffortSlider(options) {\r\n    var opts = options || {};\r\n    var doc = opts.document || (typeof document !== \"undefined\" ? document : null);\r\n    var win = opts.window || (doc && doc.defaultView) || (typeof window !== \"undefined\" ? window : globalRoot);\r\n    if (!doc || !doc.body) return null;\r\n\r\n    if (win && win.__agCodexEffortSliderInstance && typeof win.__agCodexEffortSliderInstance.stop === \"function\") {\r\n      try {\r\n        win.__agCodexEffortSliderInstance.stop();\r\n      } catch (err) {\r\n        // 忽略旧实例卸载错误\r\n      }\r\n    }\r\n\r\n    installStyles(doc);\r\n    var settingsUi = installSettingsUi({ document: doc, window: win });\r\n    var agObs = installAntigravityObserver({ document: doc, window: win });\r\n\r\n    var activeGenericMount = null;\r\n    var menuObs = installMenuObserver({\r\n      document: doc,\r\n      window: win,\r\n      onChange: function (current) {\r\n        if (activeGenericMount) {\r\n          activeGenericMount.unmount();\r\n          activeGenericMount = null;\r\n        }\r\n        if (!current || !current.container) return;\r\n        var seat = opts.seat || findSeatEffort(win);\r\n        if (!seat) return;\r\n        activeGenericMount = mountCodexEffortSlider({\r\n          container: current.container,\r\n          row: current.row,\r\n          seat: seat,\r\n          document: doc,\r\n          window: win\r\n        });\r\n      }\r\n    });\r\n\r\n    var instance = {\r\n      stop: function () {\r\n        if (activeGenericMount) {\r\n          activeGenericMount.unmount();\r\n          activeGenericMount = null;\r\n        }\r\n        menuObs.stop();\r\n        agObs.stop();\r\n        settingsUi.stop();\r\n        if (win && win.__agCodexEffortSliderInstance === instance) {\r\n          delete win.__agCodexEffortSliderInstance;\r\n        }\r\n      },\r\n      rescan: function () {\r\n        agObs.rescan();\r\n        menuObs.rescan();\r\n      }\r\n    };\r\n\r\n    if (win) {\r\n      win.__agCodexEffortSliderInstance = instance;\r\n    }\r\n    return instance;\r\n  }\r\n\r\n  // 在浏览器主世界（非 Node 测试环境且非禁用自动启动）下自动挂载\r\n  if (\r\n    typeof window !== \"undefined\" &&\r\n    typeof document !== \"undefined\" &&\r\n    !window.__agCodexEffortSliderDisableAutoBoot\r\n  ) {\r\n    var boot = function () {\r\n      if (document.body && (findAntigravityTrigger(document) || window.__agCodexEffortSliderForceBoot)) {\r\n        installCodexEffortSlider({ document: document, window: window });\r\n      } else if (document.body) {\r\n        // 页面还在异步挂载 React 根节点时，启动守护观察器\r\n        installCodexEffortSlider({ document: document, window: window });\r\n      }\r\n    };\r\n    if (document.readyState === \"loading\") {\r\n      document.addEventListener(\"DOMContentLoaded\", boot, { once: true });\r\n    } else {\r\n      boot();\r\n    }\r\n  }\r\n\r\n  return {\r\n    mountCodexEffortSlider: mountCodexEffortSlider,\r\n    installMenuObserver: installMenuObserver,\r\n    installAntigravityObserver: installAntigravityObserver,\r\n    installCodexEffortSlider: installCodexEffortSlider,\r\n    findInferenceRow: findInferenceRow,\r\n    findEffortTrigger: findEffortTrigger,\r\n    findAntigravityTrigger: findAntigravityTrigger,\r\n    findAntigravityPanel: findAntigravityPanel,\r\n    findPermissionsTrigger: findPermissionsTrigger,\r\n    readAntigravityFiberContext: readAntigravityFiberContext,\r\n    resolveModelEffortProfile: resolveModelEffortProfile,\r\n    commitAntigravityModelOption: commitAntigravityModelOption,\r\n    parseModelLabel: parseModelLabel,\r\n    syncTriggerColor: syncTriggerColor,\r\n    pctFromIndex: pctFromIndex,\r\n    indexFromPct: indexFromPct,\r\n    detentTargetIndex: detentTargetIndex,\r\n    energyForPct: energyForPct,\r\n    energyStopsFor: energyStopsFor,\r\n    speedFor: speedFor,\r\n    particleCountFor: particleCountFor,\r\n    starCountFor: starCountFor,\r\n    PARTICLES: PARTICLES,\r\n    starBrightnessFor: starBrightnessFor,\r\n    starDurationFor: starDurationFor,\r\n    starDelayFor: starDelayFor,\r\n    starLayerOpacityFor: starLayerOpacityFor,\r\n    starHash01: starHash01,\r\n    STARFIELD_DURATION_MEAN: STARFIELD_DURATION_MEAN,\r\n    STARFIELD_DURATION_SPREAD: STARFIELD_DURATION_SPREAD,\r\n    STARFIELD_MIN: STARFIELD_MIN,\r\n    GOLDEN_RATIO: GOLDEN_RATIO,\r\n    MAX_SPEED_FACTOR: MAX_SPEED_FACTOR,\r\n    REDUCED_MOTION_SLOWDOWN: REDUCED_MOTION_SLOWDOWN,\r\n    readSettings: readSettings,\r\n    writeSettings: writeSettings,\r\n    resetSettings: resetSettings,\r\n    onSettingsChange: onSettingsChange,\r\n    normalizeSettings: normalizeSettings,\r\n    schemaDefaults: schemaDefaults,\r\n    motionMode: motionMode,\r\n    motionParamsForMode: motionParamsForMode,\r\n    tracePush: tracePush,\r\n    dumpTrace: dumpTrace,\r\n    traceClear: traceClear,\r\n    installSettingsUi: installSettingsUi,\r\n    openSettingsPanel: openSettingsPanel,\r\n    SETTINGS_SCHEMA: SETTINGS_SCHEMA,\r\n    SETTINGS_VERSION: SETTINGS_VERSION,\r\n    SETTINGS_KEY: SETTINGS_KEY,\r\n    SETTINGS_EVENT: SETTINGS_EVENT,\r\n    MIN_HEIGHT_SLOTS: MIN_HEIGHT_SLOTS,\r\n    fillColorFor: fillColorFor,\r\n    hexToRgba: hexToRgba,\r\n    applyRowRing: applyRowRing,\r\n    fillBackgroundFor: fillBackgroundFor,\r\n    valueColorFor: valueColorFor,\r\n    isOffLevel: isOffLevel,\r\n    findValueElement: findValueElement,\r\n    findSeatEffort: findSeatEffort,\r\n    knobOffsetOf: knobOffsetOf,\r\n    KNOB_RADIUS: KNOB_RADIUS,\r\n    KNOB_SIZE: KNOB_SIZE,\r\n    TRACK_HEIGHT: TRACK_HEIGHT,\r\n    BASE_SPEEDUP: BASE_SPEEDUP,\r\n    ENERGY_START: ENERGY_START,\r\n    ENERGY_END: ENERGY_END,\r\n    clamp01: clamp01,\r\n    clampAbs: clampAbs,\r\n    installStyles: installStyles,\r\n    MOTION: MOTION,\r\n    MOTION_REDUCED: MOTION_REDUCED,\r\n    MOTION_FAST: MOTION_FAST,\r\n    RELEASE_PROJECT_S: RELEASE_PROJECT_S,\r\n    POINTER_SPEED_EMA: POINTER_SPEED_EMA,\r\n    POINTER_STALE_S: POINTER_STALE_S,\r\n    POINTER_SPEED_TAU: POINTER_SPEED_TAU,\r\n    motionStep: motionStep,\r\n    motionSettled: motionSettled,\r\n    decayPointerSpeed: decayPointerSpeed,\r\n    releaseIndexFor: releaseIndexFor,\r\n    isClaudeModel: isClaudeModel,\r\n    claudeIntensityFor: claudeIntensityFor,\r\n    claudeSpeedFor: claudeSpeedFor,\r\n    paintDither: paintDither,\r\n    ditherAlphaAt: ditherAlphaAt,\r\n    valueNoise: valueNoise,\r\n    hash01: hash01,\r\n    fillRoundRect: fillRoundRect,\r\n    surfaceIsDark: surfaceIsDark,\r\n    CLAUDE_CELL: CLAUDE_CELL,\r\n    CLAUDE_ROWS: CLAUDE_ROWS,\r\n    CLAUDE_SWEEP_MS: CLAUDE_SWEEP_MS,\r\n    CLAUDE_KNOB_W: CLAUDE_KNOB_W,\r\n    CLAUDE_KNOB_H: CLAUDE_KNOB_H,\r\n    CLAUDE_KNOB_R: CLAUDE_KNOB_R\r\n  };\r\n});\r\n";
  const __agInjectMainWorld = () => {
    try {
      if (electron_1 && electron_1.webFrame && typeof electron_1.webFrame.executeJavaScript === 'function') {
        void electron_1.webFrame.executeJavaScript(__agCodexSliderCode);
      }
    } catch (err) {
      console.error('[CodexSlider] webFrame executeJavaScript error:', err);
    }
  };
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', __agInjectMainWorld, { once: true });
    } else {
      __agInjectMainWorld();
    }
  }
} catch (err) {
  console.error('[CodexSlider] Preload bootstrap error:', err);
}
/* __AG_CODEX_EFFORT_SLIDER_END__ */
