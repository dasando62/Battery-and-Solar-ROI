// js/uiEvents.js
import { state } from './state.js';
import { gatherConfigFromUI } from './config.js';
import { runSimulation } from './analysis.js';
import { renderResults } from './uiRender.js';
import { getNumericInput } from './utils.js';
import { handleUsageCsv, handleSolarCsv } from './dataParser.js';
import { wireLoadSettings, wireSaveSettings } from './storage.js';
import {
    renderDebugDataTable,
    renderExistingSystemDebugTable,
    renderNewSystemDebugTable,
    renderProvidersDebugTable,
    renderAnalysisPeriodDebugTable,
    renderLoanDebugTable,
    renderOpportunityCostDebugTable
} from './debugTables.js';
import { generateHourlySolarProfileFromDaily } from './profiles.js';

export function setupUiEvents() {
    // File Inputs
    document.getElementById("usageCsv")?.addEventListener("change", handleUsageCsv);
    document.getElementById("solarCsv")?.addEventListener("change", handleSolarCsv);
    wireLoadSettings('loadSettings');
    wireSaveSettings('saveSettings');

    // Main "Run Analysis" Button
    document.getElementById('runAnalysis')?.addEventListener('click', () => {
        try {
            const config = gatherConfigFromUI();
            
            if (config.selectedProviders.length === 0) { alert("Please select at least one provider."); return; }
            if (!config.useManual && (!state.electricityData || state.electricityData.length === 0)) { alert("Please upload a valid CSV file, or select manual input."); return; }

            const simulationData = config.useManual ? {
                'Q1_Summer': { avgPeak: getNumericInput("summerDailyPeak"), avgShoulder: getNumericInput("summerDailyShoulder"), avgOffPeak: getNumericInput("summerDailyOffPeak"), avgSolar: getNumericInput("summerDailySolar") },
                'Q2_Autumn': { avgPeak: getNumericInput("autumnDailyPeak"), avgShoulder: getNumericInput("autumnDailyShoulder"), avgOffPeak: getNumericInput("autumnDailyOffPeak"), avgSolar: getNumericInput("autumnDailySolar") },
                'Q3_Winter': { avgPeak: getNumericInput("winterDailyPeak"), avgShoulder: getNumericInput("winterDailyShoulder"), avgOffPeak: getNumericInput("winterDailyOffPeak"), avgSolar: getNumericInput("winterDailySolar") },
                'Q4_Spring': { avgPeak: getNumericInput("springDailyPeak"), avgShoulder: getNumericInput("springDailyShoulder"), avgOffPeak: getNumericInput("springDailyOffPeak"), avgSolar: getNumericInput("springDailySolar") },
            } : state.quarterlyAverages;

            if (!config.useManual && state.solarData.length > 0) {
                const solarProfileSourceKw = config.existingSolarKW > 0 ? config.existingSolarKW : 1;
                let tempProfile = Array(24).fill(0);
                let totalDays = 0;
                state.solarData.forEach(day => { day.hourly.forEach((kwh, hour) => { tempProfile[hour] += kwh; }); totalDays++; });
                if (totalDays > 0) { config.hourlySolarProfilePerKw = tempProfile.map(totalKwh => totalKwh / totalDays / solarProfileSourceKw); }
            } else {
                config.hourlySolarProfilePerKw = generateHourlySolarProfileFromDaily(config.manualSolarProfile);
            }

            const resultsObject = runSimulation(config, simulationData);
            renderResults(resultsObject);
            state.analysisResults = resultsObject.financials;
            state.analysisConfig = resultsObject.config;
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