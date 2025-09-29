// js/uiEvents.js
//Version 9.6
import { state } from './state.js';
import { gatherConfigFromUI } from './config.js';
import { calculateDetailedSizing, runSimulation } from './analysis.js';
import { renderResults, renderSizingResults } from './uiRender.js';
import { getNumericInput, getSimulationData, displayError, clearError } from './utils.js';
import { handleUsageCsv, handleSolarCsv } from './dataParser.js';
import { wireLoadSettings, wireSaveSettings } from './storage.js';
import { hideAllDebugContainers, renderDebugDataTable, renderExistingSystemDebugTable, renderProvidersDebugTable, renderAnalysisPeriodDebugTable, renderLoanDebugTable, renderOpportunityCostDebugTable } from './debugTables.js';
import { saveProvider, deleteProvider, getProviders } from './providerManager.js';
import { renderProviderSettings } from './uiDynamic.js';

// Standalone function to be called from multiple places
export function toggleExistingSolar() {
    const noSolarCheckbox = document.getElementById('noExistingSolar');
    if (!noSolarCheckbox) return;

    const solarCsvLabel = document.getElementById('solarCsvLabel');
    const solarCsvInput = document.getElementById('solarCsv');
    const solarCounts = document.getElementById('solarCounts');
    const existingSolarKWInput = document.getElementById('existingSolarKW');
    const existingSolarInverterInput = document.getElementById('existingSolarInverter');

    const isDisabled = noSolarCheckbox.checked;
    if (solarCsvLabel) solarCsvLabel.style.display = isDisabled ? 'none' : 'block';
    if (existingSolarKWInput) existingSolarKWInput.disabled = isDisabled;
    if (existingSolarInverterInput) existingSolarInverterInput.disabled = isDisabled;

    if (isDisabled) {
        if (solarCsvInput) solarCsvInput.value = null;
        if (solarCounts) solarCounts.textContent = '';
        if (existingSolarKWInput) existingSolarKWInput.value = '0';
        if (existingSolarInverterInput) existingSolarInverterInput.value = '0';
        
        if (state.electricityData && state.electricityData.length > 0) {
            state.solarData = state.electricityData.map(day => ({
                date: day.date,
                hourly: Array(24).fill(0)
            }));
            if (solarCounts) solarCounts.textContent = `${state.solarData.length} days of zero-solar data generated.`;
        } else {
            state.solarData = null;
        }
    } else {
        if (solarCounts) solarCounts.textContent = '';
    }
}

export function wireStaticEvents() {
    document.getElementById('noExistingSolar')?.addEventListener('change', toggleExistingSolar);
    
    document.getElementById('manualInputToggle')?.addEventListener('change', (e) => {
        document.getElementById('csvInputSection').style.display = e.target.checked ? 'none' : 'block';
        document.getElementById('manualInputSection').style.display = e.target.checked ? 'block' : 'none';
    });
    document.getElementById('debugToggle')?.addEventListener('change', (e) => {
        const display = e.target.checked ? 'inline-block' : 'none';
        document.querySelectorAll('.debug-button').forEach(button => button.style.display = display);
        if (!e.target.checked) hideAllDebugContainers();
    });
    document.getElementById("usageCsv")?.addEventListener("change", handleUsageCsv);
    document.getElementById("solarCsv")?.addEventListener("change", handleSolarCsv);
    wireLoadSettings('loadSettings');
    wireSaveSettings('saveSettings');
    document.getElementById('calculateSizing')?.addEventListener('click', handleCalculateSizing);
    document.getElementById('runAnalysis')?.addEventListener('click', handleRunAnalysis);
    document.getElementById('enableBlackoutSizing')?.addEventListener('change', (e) => {
        document.getElementById('blackoutSettingsContainer').style.display = e.target.checked ? 'block' : 'none';
    });
    document.getElementById('enableLoan')?.addEventListener('change', (e) => {
        document.getElementById('loanSettingsContainer').style.display = e.target.checked ? 'block' : 'none';
    });
    document.getElementById('enableDiscountRate')?.addEventListener('change', (e) => {
        document.getElementById('discountRateSettingsContainer').style.display = e.target.checked ? 'block' : 'none';
    });
    document.getElementById('showRawDataDebug')?.addEventListener('click', (e) => {
        const container = document.getElementById('raw-data-debug-container');
        if (container) {
            const isHidden = container.style.display === 'none';
            container.style.display = isHidden ? 'block' : 'none';
            e.target.textContent = isHidden ? 'Hide Raw Data Tables' : 'Show Raw Data Tables';
        }
    });
    document.getElementById('add-provider-button')?.addEventListener('click', () => {
        const newProvider = { name: "New Provider", id: `custom_${Date.now()}`, importComponent: 'TIME_OF_USE_IMPORT', exportComponent: 'FLAT_RATE_FIT', exportType: 'flat', gridChargeEnabled: false, gridChargeStart: 23, gridChargeEnd: 5 };
        saveProvider(newProvider);
        renderProviderSettings();
        wireDynamicProviderEvents();
    });
    document.getElementById("showDataDebugTable")?.addEventListener("click", () => renderDebugDataTable(state));
    document.getElementById("showExistingSystemDebugTable")?.addEventListener("click", () => renderExistingSystemDebugTable(state));
    document.getElementById("showProvidersDebugTable")?.addEventListener("click", () => renderProvidersDebugTable(state));
    document.getElementById("showAnalysisPeriodDebugTable")?.addEventListener("click", renderAnalysisPeriodDebugTable);
    document.getElementById("showLoanDebugTable")?.addEventListener("click", renderLoanDebugTable);
    document.getElementById("showOpportunityCostDebugTable")?.addEventListener("click", renderOpportunityCostDebugTable);
}

export function wireDynamicProviderEvents() {
    const providerContainer = document.getElementById('provider-settings-container');
    if (!providerContainer) return;
    providerContainer.addEventListener('click', (event) => {
        const target = event.target;
        if (target.classList.contains('delete-provider-button')) {
            const providerId = target.dataset.id;
            if (confirm(`Are you sure you want to delete this provider?`)) {
                deleteProvider(providerId);
                renderProviderSettings();
                wireDynamicProviderEvents();
            }
        }
        if (target.classList.contains('save-provider-button')) {
            const providerId = target.dataset.id;
            const providerDetailsContainer = document.querySelector(`.provider-details[data-provider-id="${providerId}"]`);
            if (!providerDetailsContainer) return;
            const allProviders = getProviders();
            const providerToSave = allProviders[providerId];
            providerDetailsContainer.querySelectorAll('.provider-input').forEach(input => {
                const field = input.dataset.field;
                if (input.type === 'checkbox') {
                    providerToSave[field] = input.checked;
                } else if (input.type === 'number') {
                    providerToSave[field] = parseFloat(input.value) || 0;
                } else {
                    providerToSave[field] = input.value;
                }
            });
            saveProvider(providerToSave);
            const statusEl = document.getElementById(`save-status-${providerId.toLowerCase()}`);
            if(statusEl) {
                statusEl.textContent = "Saved!";
                setTimeout(() => { statusEl.textContent = ""; }, 2000);
            }
        }
    });
}


function handleCalculateSizing() {
    try {
        clearError();
        const config = gatherConfigFromUI();
        const recommendationSection = document.getElementById('sizing-recommendation-section');
        if (recommendationSection) recommendationSection.style.display = 'none';
        if (config.useManual || !Array.isArray(state.electricityData) || state.electricityData.length === 0 || !Array.isArray(state.solarData) || state.solarData.length === 0) {
            displayError("Detailed sizing requires both electricity and solar CSV files to be uploaded and processed.", "sizing-error-message");
            return;
        }
        const recommendationContainer = document.getElementById('recommendationContainer');
        if (recommendationContainer) recommendationContainer.innerHTML = '<p>Calculating...</p>';
        if (recommendationSection) recommendationSection.style.display = 'block';
        setTimeout(() => {
            let correctedElectricityData = JSON.parse(JSON.stringify(state.electricityData));
            const solarDataMap = new Map(state.solarData.map(day => [day.date, day.hourly]));
            correctedElectricityData.forEach(day => {
                const hourlySolar = solarDataMap.get(day.date);
                if (hourlySolar) {
                    const trueConsumption = Array(24).fill(0);
                    for (let h = 0; h < 24; h++) {
                        const gridImport = day.consumption[h] || 0;
                        const gridExport = day.feedIn[h] || 0;
                        const solarGeneration = hourlySolar[h] || 0;
                        const selfConsumed = Math.max(0, solarGeneration - gridExport);
                        trueConsumption[h] = gridImport + selfConsumed;
                    }
                    day.consumption = trueConsumption;
                }
            });
            const touHours = {
                peak: config.providers[config.selectedProviders[0]].importData.peakHours || [],
                shoulder: config.providers[config.selectedProviders[0]].importData.shoulderHours || [],
            };
            const simulationData = getSimulationData(touHours, correctedElectricityData);
            if (!simulationData) {
                displayError("Could not get seasonal data. Please check CSV or manual inputs.", "sizing-error-message");
                return;
            }
            const sizingResults = calculateDetailedSizing(correctedElectricityData, state.solarData, config, simulationData);
            if (sizingResults) {
                renderSizingResults(sizingResults, state);
            } else {
                displayError("Sizing calculation failed. Please check the data files.", "sizing-error-message");
            }
        }, 10);
    } catch (error) {
        console.error("Error during sizing calculation:", error);
        displayError("An unexpected error occurred during the sizing calculation.", "sizing-error-message");
    }
}

function handleRunAnalysis() {
    setTimeout(() => {
        try {
            clearError();
            const config = gatherConfigFromUI();
            if (config.selectedProviders.length === 0) {
                displayError("Please select at least one provider to run the analysis.", "provider-selection-error");
                return;
            }
            let simulationData;
            if (config.useManual) {
                simulationData = {
                    'Q1_Summer': { avgPeak: getNumericInput("summerDailyPeak"), avgShoulder: getNumericInput("summerDailyShoulder"), avgOffPeak: getNumericInput("summerDailyOffPeak"), avgSolar: getNumericInput("summerDailySolar") },
                    'Q2_Autumn': { avgPeak: getNumericInput("autumnDailyPeak"), avgShoulder: getNumericInput("autumnDailyShoulder"), avgOffPeak: getNumericInput("autumnDailyOffPeak"), avgSolar: getNumericInput("autumnDailySolar") },
                    'Q3_Winter': { avgPeak: getNumericInput("winterDailyPeak"), avgShoulder: getNumericInput("winterDailyShoulder"), avgOffPeak: getNumericInput("winterDailyOffPeak"), avgSolar: getNumericInput("winterDailySolar") },
                    'Q4_Spring': { avgPeak: getNumericInput("springDailyPeak"), avgShoulder: getNumericInput("springDailyShoulder"), avgOffPeak: getNumericInput("springDailyOffPeak"), avgSolar: getNumericInput("springDailySolar") },
                };
            } else {
                if (!state.electricityData || state.electricityData.length === 0) {
                    displayError("Please upload your electricity usage CSV to run the analysis.", "data-input-error");
                    return;
                }
                const touHours = {
                    peak: config.providers[config.selectedProviders[0]].importData.peakHours || [],
                    shoulder: config.providers[config.selectedProviders[0]].importData.shoulderHours || [],
                };
                simulationData = getSimulationData(touHours, state.electricityData);
            }
            if (!simulationData) {
                displayError("Could not calculate seasonal averages. Please check your data.", "data-input-error");
                return;
            }
            const resultsObject = runSimulation(config, simulationData, state.electricityData);
            renderResults(resultsObject);
            state.analysisResults = resultsObject.financials;
            state.analysisConfig = resultsObject.config;
            state.rawData = resultsObject.rawData;
        } catch (error) {
            console.error("An error occurred during analysis:", error);
            displayError("An unexpected error occurred during analysis. Check the console.", "run-analysis-error");
        }
    }, 0);
}