// js/uiDynamic.js
//Version 1.0.7
import { getProviders } from './providerManager.js';
import { sanitize } from './utils.js';

function renderConditionRow(condition, providerId, index) {
    const hoursInput = (condition.condition.metric === 'import_in_window')
        ? `<input type="text" class="provider-input" data-field="condition.hours" placeholder="e.g., 5pm-7pm" value="${condition.condition.hours || ''}">`
        : '';

    return `
        <div class="rule-row condition-row" data-index="${index}">
            <div class="rule-row-content">
                <input type="text" class="provider-input" data-field="name" placeholder="Condition Name" value="${condition.name || ''}">
                
                <span class="rule-label" title="Enter a comma-separated list of months (1-12), leave blank for all year.">Months:</span>
                <input type="text" class="provider-input" data-field="months" placeholder="e.g., 4,5,6,7,8,9" value="${(condition.months || []).join(',')}" title="Comma-separated list of months (1-12). Leave blank for all year.">
                
                <span class="rule-label">IF</span>
                <select class="provider-input" data-field="condition.metric">
                    <option value="peak_import" ${condition.condition.metric === 'peak_import' ? 'selected' : ''}>Peak Import is</option>
                    <option value="net_grid_usage" ${condition.condition.metric === 'net_grid_usage' ? 'selected' : ''}>Net Grid Usage is</option>
                    <option value="import_in_window" ${condition.condition.metric === 'import_in_window' ? 'selected' : ''}>Import during</option>
                </select>
                ${hoursInput}
                <select class="provider-input" data-field="condition.operator">
                    <option value="less_than_or_equal_to" ${condition.condition.operator === 'less_than_or_equal_to' ? 'selected' : ''}>&lt;=</option>
                    <option value="less_than" ${condition.condition.operator === 'less_than' ? 'selected' : ''}>&lt;</option>
                    <option value="greater_than" ${condition.condition.operator === 'greater_than' ? 'selected' : ''}>&gt;</option>
                    <option value="greater_than_or_equal_to" ${condition.condition.operator === 'greater_than_or_equal_to' ? 'selected' : ''}>&gt;=</option>
                </select>
                <input type="number" step="0.01" class="provider-input" data-field="condition.value" placeholder="Value (kWh)" value="${condition.condition.value ?? 0}">
                
                <span class="rule-label">THEN</span>
                <select class="provider-input" data-field="action.type">
                    <option value="flat_credit" ${condition.action.type === 'flat_credit' ? 'selected' : ''}>Apply Credit</option>
                    <option value="flat_charge" ${condition.action.type === 'flat_charge' ? 'selected' : ''}>Apply Charge</option>
                </select>
                <span class="rule-label">$</span>
                <input type="number" step="0.01" class="provider-input" data-field="action.value" placeholder="Amount" value="${condition.action.value ?? 0}">

                <button class="remove-condition-button" data-id="${providerId}" data-index="${index}" title="Remove this Rule">-</button>
            </div>
        </div>`;
}

function renderRuleRow(rule, providerId, ruleType, index) {
    const hoursInput = (rule.type === 'tou')
        ? `<input type="text" class="provider-input" data-field="hours" placeholder="Hours (e.g., 7am-10am)" value="${rule.hours || ''}">`
        : '';
    const limitInput = (rule.type === 'tiered')
        ? `<input type="number" step="0.1" class="provider-input" data-field="limit" placeholder="Limit (kWh)" value="${rule.limit || ''}">`
        : '';

    return `
        <div class="rule-row" data-index="${index}">
            <div class="rule-row-content">
                <select class="provider-input" data-field="type">
                    <option value="tou" ${rule.type === 'tou' ? 'selected' : ''}>Time of Use</option>
                    <option value="tiered" ${rule.type === 'tiered' ? 'selected' : ''}>Tiered</option>
                    <option value="flat" ${rule.type === 'flat' ? 'selected' : ''}>Flat Rate</option>
                </select>
                <input type="text" class="provider-input" data-field="name" placeholder="Rule Name" value="${rule.name || ''}">
                <label class="rule-label">$</label>
                <input type="number" step="0.001" class="provider-input" data-field="rate" value="${rule.rate || 0}">
                ${hoursInput}
                ${limitInput}
                <button class="remove-rule-button" data-type="${ruleType}" data-index="${index}" title="Remove this Rule">-</button>
            </div>
        </div>`;
}

export function renderProviderSettings() {
    const container = document.getElementById('provider-settings-container');
    if (!container) return;
    const allProviders = getProviders();
    let providersHTML = '';

    allProviders.forEach((provider, index) => {
        if (!provider) return;

        let importHTML = '<h4>Import Rules</h4><div class="import-rules-container">';
        (provider.importRules || []).forEach((rule, ruleIndex) => {
            importHTML += renderRuleRow(rule, provider.id, 'import', ruleIndex);
        });
        importHTML += '</div><button class="add-rule-button" data-id="${provider.id}" data-type="import">+ Add Import Rule</button>';

        let exportHTML = '<h4>Export Rules</h4><div class="export-rules-container">';
        (provider.exportRules || []).forEach((rule, ruleIndex) => {
            exportHTML += renderRuleRow(rule, provider.id, 'export', ruleIndex);
        });
        exportHTML += '</div><button class="add-rule-button" data-id="${provider.id}" data-type="export">+ Add Export Rule</button>';

        // --- NEW: A section for Special Conditions ---
        let conditionsHTML = '<h4>Special Conditions</h4><div class="conditions-container">';
        (provider.specialConditions || []).forEach((condition, conditionIndex) => {
            conditionsHTML += renderConditionRow(condition, provider.id, conditionIndex);
        });
        conditionsHTML += `<button class="add-condition-button" data-id="${provider.id}">+ Add Condition</button>`;
        
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
                
                <hr>${importHTML}
                <hr>${exportHTML}
                <hr>${conditionsHTML}
                <hr>
                
                <details class="collapsible-section">
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