// js/uiEvents.js
import { state } from './state.js';
import { gatherConfigFromUI } from './config.js';
import { runSimulation } from './analysis.js';
import { renderResults } from './uiRender.js';
import { getNumericInput, getSimulationData } from './utils.js';
import { handleUsageCsv, handleSolarCsv } from './dataParser.js';
import { wireLoadSettings, wireSaveSettings } from './storage.js';
import { hideAllDebugContainers, renderDebugDataTable, renderExistingSystemDebugTable, renderNewSystemDebugTable, renderProvidersDebugTable, renderAnalysisPeriodDebugTable, renderLoanDebugTable, renderOpportunityCostDebugTable } from './debugTables.js';
import { generateHourlySolarProfileFromDaily } from './profiles.js';
export function setupUiEvents() {
    // UI Toggles
    const noSolarCheckbox = document.getElementById('noExistingSolar');
    if (noSolarCheckbox) {
        const existingSystemInputs = [document.getElementById('existingSolarKW'), document.getElementById('existingSolarInverter'), document.getElementById('existingBattery'), document.getElementById('existingBatteryInverter')];
        const solarCsvLabel = document.getElementById('solarCsvLabel');
        const solarCsvInput = document.getElementById('solarCsv');
        const solarCounts = document.getElementById('solarCounts');
        const toggleExistingSolar = () => {
            const isDisabled = noSolarCheckbox.checked;
            existingSystemInputs.forEach(input => { if (input) { input.disabled = isDisabled; if (isDisabled) input.value = '0'; } });
            if (solarCsvLabel) solarCsvLabel.style.display = isDisabled ? 'none' : 'block';
            if (isDisabled) {
                if (solarCsvInput) solarCsvInput.value = null;
                if (solarCounts) solarCounts.textContent = '';
                state.solarData = null; state.quarterlyAverages = null;
            }
        };
        noSolarCheckbox.addEventListener('change', toggleExistingSolar);
        toggleExistingSolar();
    }
    const manualToggle = document.getElementById('manualInputToggle');
    if (manualToggle) {
        const csvSection = document.getElementById('csvInputSection');
        const manualSection = document.getElementById('manualInputSection');
        const toggleInputMethod = () => {
            const isManual = manualToggle.checked;
            if (csvSection) csvSection.style.display = isManual ? 'none' : 'block';
            if (manualSection) manualSection.style.display = isManual ? 'block' : 'none';
            if (isManual) { state.electricityData = null; state.solarData = null; state.quarterlyAverages = null; document.getElementById('usageCounts').textContent = ''; document.getElementById('solarCounts').textContent = ''; }
        };
        manualToggle.addEventListener('change', toggleInputMethod);
        toggleInputMethod();
    }
    const debugToggle = document.getElementById('debugToggle');
    if (debugToggle) {
        const debugButtons = document.querySelectorAll('.debug-button');
        const toggleDebugTools = () => {
            const isEnabled = debugToggle.checked;
            const display = isEnabled ? 'inline-block' : 'none';
            debugButtons.forEach(button => { button.style.display = display; });
            if (!isEnabled) { hideAllDebugContainers(); }
        };
        debugToggle.addEventListener('change', toggleDebugTools);
        toggleDebugTools();
    }
    // File Inputs
    document.getElementById("usageCsv")?.addEventListener("change", handleUsageCsv);
    document.getElementById("solarCsv")?.addEventListener("change", handleSolarCsv);
    wireLoadSettings('loadSettings');
    wireSaveSettings('saveSettings');
        // --- Loan and Opportunity Cost Toggles ---
    const loanToggle = document.getElementById('enableLoan');
    if (loanToggle) {
        const loanSettings = document.getElementById('loanSettingsContainer');
        const loanDebugTable = document.getElementById('loanDebugTableContainer');
        const toggleLoanUI = () => {
            const isEnabled = loanToggle.checked;
            if (loanSettings) loanSettings.style.display = isEnabled ? 'block' : 'none';
            // If disabled, also hide the debug table
            if (!isEnabled && loanDebugTable) {
                loanDebugTable.style.display = 'none';
            }
        };
        loanToggle.addEventListener('change', toggleLoanUI);
        toggleLoanUI(); // Run on page load
    }

    const discountRateToggle = document.getElementById('enableDiscountRate');
    if (discountRateToggle) {
        const discountSettings = document.getElementById('discountRateSettingsContainer');
        const discountDebugTable = document.getElementById('opportunityCostDebugTableContainer');
        const toggleDiscountUI = () => {
            const isEnabled = discountRateToggle.checked;
            if (discountSettings) discountSettings.style.display = isEnabled ? 'block' : 'none';
            // If disabled, also hide the debug table
            if (!isEnabled && discountDebugTable) {
                discountDebugTable.style.display = 'none';
            }
        };
        discountRateToggle.addEventListener('change', toggleDiscountUI);
        toggleDiscountUI(); // Run on page load
    }
	// Provider Checkbox Toggles
    document.querySelectorAll('.providerCheckbox').forEach(checkbox => {
        const toggleProviderSettings = () => {
            const settingsDiv = document.getElementById(`${checkbox.value.toLowerCase()}Settings`);
            if (settingsDiv) { settingsDiv.style.display = checkbox.checked ? 'block' : 'none'; }
        };
        checkbox.addEventListener('change', toggleProviderSettings);
        toggleProviderSettings();
    });
    // Main "Run Analysis" Button
    document.getElementById('runAnalysis')?.addEventListener('click', () => {
        try {
            const config = gatherConfigFromUI();
            if (config.selectedProviders.length === 0) { alert("Please select at least one provider."); return; }
            if (!config.useManual && (!state.electricityData || state.electricityData.length === 0)) { alert("Please upload a valid CSV file, or select manual input."); return; }
            const simulationData = getSimulationData(state);
            if (!simulationData) { alert("Could not calculate seasonal averages. Please check your data files."); return; }
            if (!config.useManual && (config.noExistingSolar || state.solarData)) {
                if (config.noExistingSolar) {
                    config.hourlySolarProfilePerKw = Array(24).fill(0);
                } else if (state.solarData.length > 0) {
                    const solarProfileSourceKw = config.existingSolarKW > 0 ? config.existingSolarKW : 1;
                    let tempProfile = Array(24).fill(0);
                    let totalDays = 0;
                    state.solarData.forEach(day => { day.hourly.forEach((kwh, hour) => { tempProfile[hour] += kwh; }); totalDays++; });
                    if (totalDays > 0) { config.hourlySolarProfilePerKw = tempProfile.map(totalKwh => totalKwh / totalDays / solarProfileSourceKw); }
                }
            } else if (config.useManual) {
                config.hourlySolarProfilePerKw = generateHourlySolarProfileFromDaily(config.manualSolarProfile);
            } else {
                 alert("Please upload a Solar Generation CSV or check 'No existing solar'."); return;
            }
            const resultsObject = runSimulation(config, simulationData);
            renderResults(resultsObject);
            state.analysisResults = resultsObject.financials;
            state.analysisConfig = resultsObject.config;
            state.rawData = resultsObject.rawData;
        } catch (error) {
            console.error("An error occurred during analysis:", error);
            alert("An unexpected error occurred. Check the console.");
        }
    });
    // Debug Buttons
    document.getElementById("showDataDebugTable")?.addEventListener("click", () => renderDebugDataTable(state));
    document.getElementById("showExistingSystemDebugTable")?.addEventListener("click", () => renderExistingSystemDebugTable(state));
    document.getElementById("showNewSystemDebugTable")?.addEventListener("click", () => renderNewSystemDebugTable(state));
    document.getElementById("showProvidersDebugTable")?.addEventListener("click", () => renderProvidersDebugTable(state));
    document.getElementById("showAnalysisPeriodDebugTable")?.addEventListener("click", renderAnalysisPeriodDebugTable);
    document.getElementById("showLoanDebugTable")?.addEventListener("click", renderLoanDebugTable);
    document.getElementById("showOpportunityCostDebugTable")?.addEventListener("click", renderOpportunityCostDebugTable);
}