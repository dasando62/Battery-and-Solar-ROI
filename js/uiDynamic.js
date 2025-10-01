// js/uiDynamic.js
//Version 1.0.3
import { getProviders } from './providerManager.js';
import { sanitize } from './utils.js';

function renderRuleRow(rule, providerId, ruleType, index) {
    // Show/hide inputs based on rule.type
    const hoursInput = (rule.type === 'tou') 
        ? `<label>Hours: <input type="text" class="provider-input" data-field="hours" value="${rule.hours || ''}"></label>` 
        : '';
    const limitInput = (rule.type === 'tiered') 
        ? `<label>Limit (kWh): <input type="number" step="0.1" class="provider-input" data-field="limit" value="${rule.limit || ''}"></label>` 
        : '';

    return `
        <div class="rule-row" data-index="${index}">
            <select class="provider-input" data-field="type">
                <option value="tou" ${rule.type === 'tou' ? 'selected' : ''}>Time of Use</option>
                <option value="tiered" ${rule.type === 'tiered' ? 'selected' : ''}>Tiered</option>
                <option value="flat" ${rule.type === 'flat' ? 'selected' : ''}>Flat Rate</option>
            </select>
            <label>Name: <input type="text" class="provider-input" data-field="name" value="${rule.name || ''}"></label>
            <label>Rate ($): <input type="number" step="0.001" class="provider-input" data-field="rate" value="${rule.rate || 0}"></label>
            ${hoursInput}
            ${limitInput}
            <button class="remove-rule-button" data-type="${ruleType}" data-index="${index}">-</button>
        </div>`;
}

export function renderProviderSettings() {
    const container = document.getElementById('provider-settings-container');
    if (!container) return;
    const allProviders = getProviders();
    let providersHTML = '';

    allProviders.forEach((provider, index) => {
        // SAFETY CHECK: Ensure the provider object itself is valid before proceeding.
        if (!provider) return; 

        // SAFETY CHECK: Use (provider.importRules || []) to prevent errors if the array is missing.
        let importHTML = '<h4>Import Rules</h4><div class="import-rules-container">';
        (provider.importRules || []).forEach((rule, ruleIndex) => {
            importHTML += renderRuleRow(rule, provider.id, 'import', ruleIndex);
        });
		importHTML += '</div>'; // Close the wrapper
        importHTML += `<button class="add-rule-button" data-id="${provider.id}" data-type="import">+</button>`;

        // SAFETY CHECK: Do the same for the exportRules array.
        let exportHTML = '<h4>Export Rules</h4><div class="export-rules-container">';
        (provider.exportRules || []).forEach((rule, ruleIndex) => {
            exportHTML += renderRuleRow(rule, provider.id, 'export', ruleIndex);
        });
		exportHTML += '</div>';
        exportHTML += `<button class="add-rule-button" data-id="${provider.id}" data-type="export">+</button>`;

        providersHTML += `<details class="collapsible-section provider-details" ${provider.isExpanded ? 'open' : ''} data-provider-id="${provider.id}">
            <summary>
                <input type="checkbox" class="providerCheckbox" value="${provider.id}" checked>
                
                <strong style="font-size: 1.2em; margin-left: 5px;">${sanitize(provider.name || '')}</strong>
                
                <span class="provider-order-controls">
                    <button class="move-provider-up" data-index="${index}" ${index === 0 ? 'disabled' : ''}>▲</button>
                    <button class="move-provider-down" data-index="${index}" ${index === allProviders.length - 1 ? 'disabled' : ''}>▼</button>
                </span>
            </summary>
            <div class="subsettings">
                <label>Provider Name: <input type="text" class="provider-input" data-id="${provider.id}" data-field="name" value="${sanitize(provider.name || '')}"></label>
                <label>Daily Charge ($): <input type="number" step="0.001" class="provider-input" data-id="${provider.id}" data-field="dailyCharge" value="${provider.dailyCharge ?? ''}"></label>
                <label>Rebate ($): <input type="number" step="0.01" class="provider-input" data-id="${provider.id}" data-field="rebate" value="${provider.rebate ?? 0}"></label>
                <label>Monthly Fee ($): <input type="number" step="0.01" class="provider-input" data-id="${provider.id}" data-field="monthlyFee" value="${provider.monthlyFee ?? 0}"></label>
                
                <hr>${importHTML}<hr>${exportHTML}<hr>
                
                <details class="collapsible-section" open>
                    <summary>Grid Charging Options</summary>
                    <div class="subsettings">
                        <label><input type="checkbox" class="provider-input" data-id="${provider.id}" data-field="gridChargeEnabled" ${provider.gridChargeEnabled ? 'checked' : ''}> Enable Grid Charging</label>
                        <label>Charge Start Hour: <input type="number" class="provider-input" data-id="${provider.id}" data-field="gridChargeStart" min="0" max="23" value="${provider.gridChargeStart ?? 0}"></label>
                        <label>Charge End Hour: <input type="number" class="provider-input" data-id="${provider.id}" data-field="gridChargeEnd" min="0" max="23" value="${provider.gridChargeEnd ?? 0}"></label>
                    </div>
                </details>
                <hr>
                <button class="delete-provider-button" data-id="${provider.id}">Delete Provider</button>
                <button class="save-provider-button" data-id="${provider.id}">Save Changes</button>
                <span id="save-status-${provider.id.toLowerCase()}" class="save-status-message"></span>
            </div>
        </details>`;
    });

    setTimeout(() => { container.innerHTML = providersHTML; }, 0);
}