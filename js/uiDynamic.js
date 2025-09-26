// js/uiDynamic.js
// Version 9.5
import { getProviders } from './providerManager.js';

export function renderProviderSettings() {
    const container = document.getElementById('provider-settings-container');
    if (!container) return;

    const allProviders = getProviders();
    let providersHTML = '';

    for (const pKey in allProviders) {
        const provider = allProviders[pKey];
        const pId = provider.id.toLowerCase();

        let importHTML = '';
        if (provider.importComponent === 'TIME_OF_USE_IMPORT') {
            importHTML = `
                <h4>Import Rates (Time of Use)</h4>
                <label>Peak Rate ($/kWh): <input type="number" step="0.001" class="provider-input" data-id="${provider.id}" data-field="peakRate" value="${provider.peakRate ?? ''}"></label>
                <label>Shoulder Rate ($/kWh): <input type="number" step="0.001" class="provider-input" data-id="${provider.id}" data-field="shoulderRate" value="${provider.shoulderRate ?? ''}"></label>
                <label>Off-Peak Rate ($/kWh): <input type="number" step="0.001" class="provider-input" data-id="${provider.id}" data-field="offPeakRate" value="${provider.offPeakRate ?? ''}"></label>
                <label>Peak Hours: <input type="text" class="provider-input" data-id="${provider.id}" data-field="peakHours" value="${provider.peakHours || ''}" placeholder="e.g., 7am-10am, 4pm-10pm"></label>
                <label>Shoulder Hours: <input type="text" class="provider-input" data-id="${provider.id}" data-field="shoulderHours" value="${provider.shoulderHours || ''}" placeholder="e.g., 10am-4pm"></label>
                <label>Off-Peak Hours: <input type="text" class="provider-input" data-id="${provider.id}" data-field="offPeakHours" value="${provider.offPeakHours || ''}" placeholder="e.g., 10pm-7am"></label>
            `;
        } else if (provider.importComponent === 'FLAT_RATE_IMPORT') {
            importHTML = `<h4>Import Rate (Flat)</h4><label>Import Rate ($/kWh): <input type="number" step="0.001" class="provider-input" data-id="${provider.id}" data-field="importRate" value="${provider.importRate ?? ''}"></label>`;
        }

        let exportHTML = '';
        if (provider.exportComponent === 'MULTI_TIER_FIT') {
            exportHTML = `
                <h4>Export Rates (Tiered)</h4>
                <label>Export Tier 1 Rate ($/kWh): <input type="number" step="0.001" class="provider-input" data-id="${provider.id}" data-field="export1Rate" value="${provider.export1Rate ?? ''}"></label>
                <label>Export Tier 1 Limit (kWh/day): <input type="number" step="0.1" class="provider-input" data-id="${provider.id}" data-field="export1Limit" value="${provider.export1Limit ?? ''}"></label>
                <label>Export Tier 2 Rate ($/kWh): <input type="number" step="0.001" class="provider-input" data-id="${provider.id}" data-field="export2Rate" value="${provider.export2Rate ?? ''}"></label>
            `;
        } else if (provider.exportComponent === 'GLOBIRD_COMPLEX_FIT') {
            exportHTML = `
                <h4>Export Rates (Complex)</h4>
                <label>Solar/Gen Feed-in (4pm-9pm) ($/kWh): <input type="number" step="0.001" class="provider-input" data-id="${provider.id}" data-field="export4pm9pmRate" value="${provider.export4pm9pmRate ?? ''}"></label>
                <label>Solar/Gen Feed-in (9pm-10am, 2pm-4pm) ($/kWh): <input type="number" step="0.001" class="provider-input" data-id="${provider.id}" data-field="export9pm10am2pm4pmRate" value="${provider.export9pm10am2pm4pmRate ?? ''}"></label>
                <label>Solar/Gen Feed-in (10am-2pm) ($/kWh): <input type="number" step="0.001" class="provider-input" data-id="${provider.id}" data-field="export10am2pmRate" value="${provider.export10am2pmRate ?? ''}"></label>
                <label>Super Export top up (First kWh/Day) ($/kWh): <input type="number" step="0.001" class="provider-input" data-id="${provider.id}" data-field="superExportRate" value="${provider.superExportRate ?? ''}"></label>
                <label>Super Export Limit (kWh/day): <input type="number" step="0.1" class="provider-input" data-id="${provider.id}" data-field="superExportLimit" value="${provider.superExportLimit ?? ''}"></label>
                <label>ZeroHero Daily Credit ($): <input type="number" step="0.01" class="provider-input" data-id="${provider.id}" data-field="zeroHeroCredit" value="${provider.zeroHeroCredit ?? ''}"></label>
            `;
        } else if (provider.exportComponent === 'FLAT_RATE_FIT') {
            exportHTML = `<h4>Export Rate (Flat)</h4><label>Export Rate ($/kWh): <input type="number" step="0.001" class="provider-input" data-id="${provider.id}" data-field="exportRate" value="${provider.exportRate ?? ''}"></label>`;
        }

                providersHTML += `
            <details class="collapsible-section provider-details" open data-provider-id="${provider.id}">
                <summary>
                    <input type="checkbox" class="providerCheckbox" value="${provider.id}" checked>
                    <strong style="font-size: 1.2em; margin-left: 5px;">${provider.name}</strong>
                </summary>
                <div class="subsettings">
                    <label>Provider Name: <input type="text" class="provider-input" data-id="${provider.id}" data-field="name" value="${provider.name || ''}"></label>
                    <label>Daily Charge ($): <input type="number" step="0.001" class="provider-input" data-id="${provider.id}" data-field="dailyCharge" value="${provider.dailyCharge ?? ''}"></label>
                    <hr>
                    ${importHTML}
                    <hr>
                    ${exportHTML}
                    
                    <hr>
                    <details class="collapsible-section" open>
                        <summary>Grid Charging Options</summary>
                        <div class="subsettings">
                            <label>
                                <input type="checkbox" class="provider-input" data-id="${provider.id}" data-field="gridChargeEnabled" ${provider.gridChargeEnabled ? 'checked' : ''}>
                                Enable Grid Charging
                            </label>
                            <label>
                                Charge Start Hour (e.g., 23 for 11 PM):
                                <input type="number" class="provider-input" data-id="${provider.id}" data-field="gridChargeStart" min="0" max="23" value="${provider.gridChargeStart || 0}">
                            </label>
                            <label>
                                Charge End Hour (e.g., 5 for 5 AM):
                                <input type="number" class="provider-input" data-id="${provider.id}" data-field="gridChargeEnd" min="0" max="23" value="${provider.gridChargeEnd || 0}">
                            </label>
                        </div>
                    </details>
                    <hr>
                    <button class="delete-provider-button" data-id="${provider.id}" style="background-color: #dc3545; color: white;">Delete Provider</button>
                    <button class="save-provider-button" data-id="${provider.id}" style="background-color: #28a745; color: white;">Save Changes</button>
                    <span id="save-status-${pId}" style="margin-left: 10px; color: green; font-weight: bold;"></span>
                </div>
            </details>
        `;
    }
    setTimeout(() => {
		container.innerHTML = providersHTML;
    }, 0);	
}