// js/debugTables.js
// Version 1.0.6
import { 
	getNumericInput, 
	getSimulationData, 
	displayError, 
	clearError 
} from './utils.js';
import { 
	generateHourlyConsumptionProfileFromDailyTOU, 
	generateHourlySolarProfileFromDaily 
} from './profiles.js';
import { simulateDay, calculateSizingRecommendations } from './analysis.js';
import { state } from './state.js';
import { calculateQuarterlyAverages } from './dataParser.js';
import { gatherConfigFromUI } from './config.js'; 

export function hideAllDebugContainers() {
    document.querySelectorAll('[id$="DebugTableContainer"]').forEach(el => el.style.display = "none");
	
}

export function calculateAverageDailyGridCharge(provider, batteryConfig, state) {
    if (!provider.gridChargeEnabled || !state.electricityData) {
        return 0;
    }

    let totalGridChargeKWh = 0;
    let daysProcessed = 0;
    const solarDataMap = new Map((state.solarData || []).map(d => [d.date, d.hourly]));

    state.electricityData.forEach(day => {
        const hourlySolar = solarDataMap.get(day.date) || Array(24).fill(0);
        // We use the same "true consumption" logic as the main simulation
        const trueHourlyConsumption = Array(24).fill(0);
        for (let h = 0; h < 24; h++) {
            const gridImport = day.consumption[h] || 0;
            const gridExport = day.feedIn[h] || 0;
            const solarGeneration = hourlySolar[h] || 0;
            const selfConsumed = Math.max(0, solarGeneration - gridExport);
            trueHourlyConsumption[h] = gridImport + selfConsumed;
        }

        const simResults = simulateDay(trueHourlyConsumption, hourlySolar, provider, batteryConfig);
        totalGridChargeKWh += simResults.dailyBreakdown.gridChargeKWh;
        daysProcessed++;
    });

    return daysProcessed > 0 ? totalGridChargeKWh / daysProcessed : 0;
}

// In debugTables.js, replace the existing helper function
function calculateAverageSOCAt6am(provider, batteryConfig, state) {
    if (!batteryConfig || batteryConfig.capacity === 0 || !state.electricityData) {
        return 0;
    }

    let totalSocAt6am = 0;
    let daysProcessed = 0;
    let currentSOC = 0; // Carry over SOC day-to-day
    const solarDataMap = new Map((state.solarData || []).map(d => [d.date, d.hourly]));

    state.electricityData.forEach(day => {
        const hourlySolar = solarDataMap.get(day.date) || Array(24).fill(0);
        const trueHourlyConsumption = Array(24).fill(0);
        for (let h = 0; h < 24; h++) {
            const gridImport = day.consumption[h] || 0;
            const gridExport = day.feedIn[h] || 0;
            const solarGeneration = hourlySolar[h] || 0;
            const selfConsumed = Math.max(0, solarGeneration - gridExport);
            trueHourlyConsumption[h] = gridImport + selfConsumed;
        }
        
        const simResults = simulateDay(trueHourlyConsumption, hourlySolar, provider, batteryConfig, currentSOC);
        currentSOC = simResults.finalSOC; // Update SOC for the next day
        totalSocAt6am += simResults.socAt6am;
        daysProcessed++;
    });
    
    const avgSocKWh = daysProcessed > 0 ? totalSocAt6am / daysProcessed : 0;
    const avgSocPercent = (avgSocKWh / batteryConfig.capacity) * 100;
    return avgSocPercent;
}

export function createBreakdownTableHTML(title, data, provider, year, escalationRate, fitConfig, getDegradedFitRate) {
    const escalationFactor = Math.pow(1 + escalationRate, year - 1);
    const dailyCharge = (provider.dailyCharge || 0) * escalationFactor;

    // FIX: Correctly find rates from the new 'importRules' array, case-insensitive
    const peakRate = (provider.importRules.find(r => r.name.toLowerCase().includes('peak'))?.rate || 0) * escalationFactor;
    const shoulderRate = (provider.importRules.find(r => r.name.toLowerCase().includes('shoulder'))?.rate || 0) * escalationFactor;
    const offPeakRate = (provider.importRules.find(r => r.name.toLowerCase().includes('off-peak'))?.rate || 0) * escalationFactor;

    let tier1ExportRate = 0;
    let tier2ExportRate = 0;
    
    // FIX: Correctly find export rates from the new 'exportRules' array
    if (provider.exportRules && provider.exportRules.length > 0) {
        const firstRule = provider.exportRules[0];
        if (firstRule.type === 'tiered') {
            tier1ExportRate = getDegradedFitRate(firstRule.rate, year, fitConfig);
            // Assume Tier 2 is the next rule in the array
            if (provider.exportRules.length > 1) {
                tier2ExportRate = getDegradedFitRate(provider.exportRules[1].rate, year, fitConfig);
            }
        } else if (firstRule.type === 'flat') {
            tier1ExportRate = getDegradedFitRate(firstRule.rate, year, fitConfig);
        }
    }

    let totalDays = 0, totalPeakKWh = 0, totalShoulderKWh = 0, totalOffPeakKWh = 0;
    let totalTier1ExportKWh = 0, totalTier2ExportKWh = 0, totalGridChargeKWh = 0, totalGridChargeCost = 0;

    let tableHTML = `<h3>${title}</h3><table class="raw-data-table"><thead><tr><th>Period</th><th>Days</th><th>Supply Charge</th><th>Grid Charge (kWh)</th><th>Grid Charge Cost</th><th>Peak Import (kWh)</th><th>Peak Charge</th><th>Shoulder Import (kWh)</th><th>Shoulder Charge</th><th>Off-Peak Import (kWh)</th><th>Off-Peak Charge</th><th>Tier 1 Export (kWh)</th><th>Tier 1 Credit</th><th>Tier 2 Export (kWh)</th><th>Tier 2 Credit</th></tr></thead><tbody>`;

    for (const season of ['Summer', 'Autumn', 'Winter', 'Spring']) {
        const seasonData = data[season];
        if (!seasonData) continue;
        
        totalDays += seasonData.days || 0;
        totalPeakKWh += seasonData.peakKWh || 0;
        totalShoulderKWh += seasonData.shoulderKWh || 0;
        totalOffPeakKWh += seasonData.offPeakKWh || 0;
        totalGridChargeKWh += seasonData.gridChargeKWh || 0;
        totalGridChargeCost += seasonData.gridChargeCost || 0;
        totalTier1ExportKWh += seasonData.tier1ExportKWh || 0;
        totalTier2ExportKWh += seasonData.tier2ExportKWh || 0;

        tableHTML += `<tr>
            <td>${season}</td><td>${seasonData.days || 0}</td>
            <td>$${((seasonData.days || 0) * dailyCharge).toFixed(2)}</td>
            <td>${(seasonData.gridChargeKWh || 0).toFixed(2)}</td>
            <td>$${(seasonData.gridChargeCost || 0).toFixed(2)}</td>
            <td>${(seasonData.peakKWh || 0).toFixed(2)}</td><td>$${((seasonData.peakKWh || 0) * peakRate).toFixed(2)}</td>
            <td>${(seasonData.shoulderKWh || 0).toFixed(2)}</td><td>$${((seasonData.shoulderKWh || 0) * shoulderRate).toFixed(2)}</td>
            <td>${(seasonData.offPeakKWh || 0).toFixed(2)}</td><td>$${((seasonData.offPeakKWh || 0) * offPeakRate).toFixed(2)}</td>
            <td>${(seasonData.tier1ExportKWh || 0).toFixed(2)}</td><td>$${((seasonData.tier1ExportKWh || 0) * tier1ExportRate).toFixed(2)}</td>
            <td>${(seasonData.tier2ExportKWh || 0).toFixed(2)}</td><td>$${((seasonData.tier2ExportKWh || 0) * tier2ExportRate).toFixed(2)}</td>
        </tr>`;
    }
    
    tableHTML += `<tr class="total-row"><td>Annual Total</td><td>${totalDays}</td><td>$${(totalDays * dailyCharge).toFixed(2)}</td><td>${totalGridChargeKWh.toFixed(2)}</td><td>$${totalGridChargeCost.toFixed(2)}</td><td>${totalPeakKWh.toFixed(2)}</td><td>$${(totalPeakKWh * peakRate).toFixed(2)}</td><td>${totalShoulderKWh.toFixed(2)}</td><td>$${(totalShoulderKWh * shoulderRate).toFixed(2)}</td><td>${totalOffPeakKWh.toFixed(2)}</td><td>$${(totalOffPeakKWh * offPeakRate).toFixed(2)}</td><td>${totalTier1ExportKWh.toFixed(2)}</td><td>$${(totalTier1ExportKWh * tier1ExportRate).toFixed(2)}</td><td>${totalTier2ExportKWh.toFixed(2)}</td><td>$${(totalTier2ExportKWh * tier2ExportRate).toFixed(2)}</td></tr>`;
    tableHTML += '</tbody></table>';
    return tableHTML;
}

export function renderDebugDataTable(state) {
    if (!document.getElementById("debugToggle")?.checked) return;
    const useManual = document.getElementById("manualInputToggle")?.checked;
    
    if (!useManual && (!state.electricityData || state.electricityData.length === 0)) {
        displayError("Please upload an electricity CSV file with data first.", "data-input-error");
        return;
    }

    hideAllDebugContainers();
    const debugContainer = document.getElementById("dataDebugTableContainer");
    
    // 1. Add "Feed In" to the table header
    let tableHTML = "<h3>Debug Data</h3><table><thead><tr><th>Date</th><th>Hour</th><th>Consumption (kWh)</th><th>Feed In (kWh)</th><th>Solar (kWh)</th></tr></thead><tbody>";
    
    if (useManual) {
        // ... (manual mode logic remains the same, you can add a column of zeros for Feed In if you like) ...
        const dailyPeak = (getNumericInput("summerDailyPeak") + getNumericInput("autumnDailyPeak") + getNumericInput("winterDailyPeak") + getNumericInput("springDailyPeak")) / 4;
        const dailyShoulder = (getNumericInput("summerDailyShoulder") + getNumericInput("autumnDailyShoulder") + getNumericInput("winterShoulder") + getNumericInput("springShoulder")) / 4;
        const dailyOffPeak = (getNumericInput("summerDailyOffPeak") + getNumericInput("autumnDailyOffPeak") + getNumericInput("winterOffPeak") + getNumericInput("springOffPeak")) / 4;
        const dailySolar = (getNumericInput("summerDailySolar") + getNumericInput("autumnDailySolar") + getNumericInput("winterDailySolar") + getNumericInput("springDailySolar")) / 4;

        const hourlyConsumption = generateHourlyConsumptionProfileFromDailyTOU(dailyPeak, dailyShoulder, dailyOffPeak);
        const hourlySolar = generateHourlySolarProfileFromDaily(dailySolar);

        for (let h = 0; h < 24; h++) {
            tableHTML += `<tr>
                            <td>Manual Average</td>
                            <td>${(h<10?'0':'')+h}:00</td>
                            <td>${(hourlyConsumption[h] || 0).toFixed(3)}</td>
                            <td>0.000</td>
                            <td>${(hourlySolar[h] || 0).toFixed(3)}</td>
                          </tr>`;
        }
    } else {
        // This is the main part to change for CSV mode
        const numEntries = Math.min(state.electricityData.length, 100);
        const solarDataMap = new Map((state.solarData || []).map(d => [d.date, d.hourly]));
        for (let d = 0; d < numEntries; d++) {
            const dayData = state.electricityData[d];
            const hourlySolar = solarDataMap.get(dayData.date) || Array(24).fill(0);
            for (let h = 0; h < 24; h++) {
                // 2. Add the dayData.feedIn value to the table row
                tableHTML += `<tr>
                                <td>${dayData.date}</td>
                                <td>${(h<10?'0':'')+h}:00</td>
                                <td>${(dayData.consumption[h] || 0).toFixed(3)}</td>
                                <td>${(dayData.feedIn[h] || 0).toFixed(3)}</td>
                                <td>${(hourlySolar[h] || 0).toFixed(3)}</td>
                              </tr>`;
            }
        }
    }

    tableHTML += "</tbody></table>";
    if (debugContainer) debugContainer.innerHTML = tableHTML;
    if (debugContainer) debugContainer.style.display = "block";
}

export function renderExistingSystemDebugTable(state) {
    if (!document.getElementById("debugToggle")?.checked) return;
	clearError();
    if (document.getElementById("manualInputToggle")?.checked || !state.electricityData || !state.solarData || state.electricityData.length === 0) {
        displayError("This debug table requires uploaded CSV data.");
        return;
    }
    hideAllDebugContainers();
    const debugContainer = document.getElementById("existingSystemDebugTableContainer");

    let totalGridImports = 0,
        totalGridExports = 0,
        totalSolarGeneration = 0;
    let totalDays = 0;

    const solarDataMap = new Map(state.solarData.map(day => [day.date, day.hourly]));

    state.electricityData.forEach(day => {
        const dateKey = day.date;
        const hourlySolar = solarDataMap.get(dateKey);

        if (hourlySolar) {
            totalDays++;
            totalSolarGeneration += hourlySolar.reduce((a, b) => a + b, 0);
            totalGridImports += day.consumption.reduce((a, b) => a + b, 0);
            totalGridExports += day.feedIn.reduce((a, b) => a + b, 0);
        }
    });

    if (totalDays === 0) {
        displayError("No overlapping data found between the two CSV files. Please ensure the date ranges are aligned.");
        return;
    }
    
    const totalSelfConsumed = totalSolarGeneration - totalGridExports;
    const totalConsumption = totalSelfConsumed + totalGridImports;


    let tableHTML = "<h3>Existing System & Baseline Data</h3><table><thead><tr><th>Parameter</th><th>Value</th></tr></thead><tbody>";
    tableHTML += `<tr><td colspan="2"><strong>Existing System Inputs</strong></td></tr>`;
    tableHTML += `<tr><td>Existing Solar Panel Size (kW)</td><td>${document.getElementById("existingSolarKW")?.value || ''}</td></tr>`;
    tableHTML += `<tr><td>Existing Solar Inverter Size (kWh)</td><td>${document.getElementById("existingSolarInverter")?.value || ''}</td></tr>`;
    tableHTML += `<tr><td>Existing Battery Size (kWh)</td><td>${document.getElementById("existingBattery")?.value || ''}</td></tr>`;
    tableHTML += `<tr><td>Existing Battery Inverter (kW)</td><td>${document.getElementById("existingBatteryInverter")?.value || ''}</td></tr>`;
    tableHTML += `<tr><td colspan="2"><strong>Baseline Data Analysis (from CSV)</strong></td></tr>`;
    tableHTML += `<tr><td>Total Days Analyzed</td><td>${totalDays} days</td></tr>`;
    tableHTML += `<tr><td>Total Consumption (Grid Imports + Self-Consumed Solar)</td><td>${totalConsumption.toFixed(2)} kWh</td></tr>`;
    tableHTML += `<tr><td>Total Solar Generation</td><td>${totalSolarGeneration.toFixed(2)} kWh</td></tr>`;
    tableHTML += `<tr><td>Total Self-Consumed Solar (Generation - Exports)</td><td>${totalSelfConsumed.toFixed(2)} kWh</td></tr>`;
    tableHTML += `<tr><td>Total Imported from Grid (from Usage CSV)</td><td>${totalGridImports.toFixed(2)} kWh</td></tr>`;
    tableHTML += `<tr><td>Total Exported to Grid (from Usage CSV)</td><td>${totalGridExports.toFixed(2)} kWh</td></tr>`;
    tableHTML += "</tbody></table>";
    if (debugContainer) debugContainer.innerHTML = tableHTML;
    if (debugContainer) debugContainer.style.display = "block";
}

export function renderNewSystemDebugTable(state) {
    if (!document.getElementById("debugToggle")?.checked) return;
	clearError();
    hideAllDebugContainers();
    const debugContainer = document.getElementById("newSystemDebugTableContainer");
    const recommendationContainer = document.getElementById("recommendationContainer");
    if (!recommendationContainer) return;

    const useManual = document.getElementById("manualInputToggle")?.checked;
    const config = gatherConfigFromUI();

    if (useManual) {
        // --- MANUAL MODE PATH ---
        // 1. Gather the seasonal averages from the UI, as the old function did.
        const simulationData = {
            'Q1_Summer': { avgPeak: getNumericInput("summerDailyPeak"), avgShoulder: getNumericInput("summerDailyShoulder"), avgOffPeak: getNumericInput("summerDailyOffPeak"), avgSolar: getNumericInput("summerDailySolar") },
            'Q2_Autumn': { avgPeak: getNumericInput("autumnDailyPeak"), avgShoulder: getNumericInput("autumnDailyShoulder"), avgOffPeak: getNumericInput("autumnDailyOffPeak"), avgSolar: getNumericInput("autumnDailySolar") },
            'Q3_Winter': { avgPeak: getNumericInput("winterDailyPeak"), avgShoulder: getNumericInput("winterDailyShoulder"), avgOffPeak: getNumericInput("winterDailyOffPeak"), avgSolar: getNumericInput("winterDailySolar") },
            'Q4_Spring': { avgPeak: getNumericInput("springDailyPeak"), avgShoulder: getNumericInput("springDailyShoulder"), avgOffPeak: getNumericInput("springDailyOffPeak"), avgSolar: getNumericInput("springDailySolar") },
        };

        // 2. Call only the heuristic sizing calculation.
        const heuristicRecs = calculateSizingRecommendations(config.recommendationCoverageTarget, simulationData);
        
        // 3. Render ONLY the heuristic results.
        let recommendationHTML = `<div class="recommendation-section">`;
        if (heuristicRecs) {
            recommendationHTML += `
                <h4>Heuristic Sizing (based on ${heuristicRecs.coverageTarget}% annual coverage)</h4>
                <p>
                    <strong>Recommended Solar: ${heuristicRecs.solar.toFixed(1)} kW</strong><br>
                    <strong>Recommended Battery: ${heuristicRecs.battery.toFixed(1)} kWh</strong><br>
                    <strong>Recommended Inverter: ${heuristicRecs.inverter.toFixed(1)} kW</strong>
                </p>`;
        }
        recommendationHTML += `</div>`;
        recommendationContainer.innerHTML = recommendationHTML;
        
        // 4. Clear the chart area as it's not applicable for manual mode.
        const newSystemEstimatesTable = document.getElementById("newSystemEstimatesTable");
        if (newSystemEstimatesTable) {
            newSystemEstimatesTable.innerHTML = '<p><em>Detailed sizing charts require CSV data.</em></p>';
        }

    } else {
        // --- CSV MODE PATH ---
        if (!state.electricityData || !state.solarData || state.electricityData.length === 0) {
            displayError("Please upload both electricity and solar CSV files to use this debug tool.");
            return;
        }

        // This path works as before, running the full detailed calculation.
        const sizingResults = calculateDetailedSizing(state.electricityData, state.solarData, config, state.quarterlyAverages);

        if (sizingResults) {
            renderSizingResults(sizingResults, state);
            setTimeout(() => {
                drawDistributionCharts(sizingResults.distributions, state);
            }, 0);
        } else {
            displayError("Sizing calculation failed for debug table.", "sizing-error-message");
        }
    }

    if (debugContainer) debugContainer.style.display = "block";
}
export function renderProvidersDebugTable(state) {
    if (!document.getElementById("debugToggle")?.checked) return;
    hideAllDebugContainers();
    const debugContainer = document.getElementById("providersDebugTableContainer");
    let tableHTML = "<h3>Provider & Tariff Inputs</h3><table><tbody>";

    if (!state.analysisConfig || !state.quarterlyAverages) {
        tableHTML += `<tr><td>Please run a successful analysis first to see provider debug info.</td></tr>`;
        tableHTML += "</tbody></table>";
        if (debugContainer) debugContainer.innerHTML = tableHTML;
        if (debugContainer) debugContainer.style.display = "block";
        return;
    }

    const simulationData = state.quarterlyAverages;

    tableHTML += `<tr><td colspan="2" class="provider-header-cell"><strong>Quarterly Averages (Daily)</strong></td></tr>`;
    for (const quarter in simulationData) {
        const q = simulationData[quarter];
        tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Peak</td><td>${(q.avgPeak).toFixed(2)} kWh</td></tr>`;
        tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Shoulder</td><td>${(q.avgShoulder).toFixed(2)} kWh</td></tr>`;
        tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Off-Peak</td><td>${(q.avgOffPeak).toFixed(2)} kWh</td></tr>`;
        tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Solar</td><td>${(q.avgSolar).toFixed(2)} kWh</td></tr>`;
    }

    state.analysisConfig.selectedProviders.forEach(pKey => {
        const providerConfig = state.analysisConfig.providers.find(p => p.id === pKey);
        if (!providerConfig) return;

        tableHTML += `<tr><td colspan="2" class="provider-header-cell"><strong>${providerConfig.name}</strong></td></tr>`;
        
        // --- ADDED THIS BLOCK BACK ---
        const batteryConfig = {
            capacity: getNumericInput("newBattery"),
            inverterKW: getNumericInput("newBatteryInverter"),
            gridChargeThreshold: getNumericInput("gridChargeThreshold"),
            socChargeTrigger: getNumericInput("socChargeTrigger")
        };
        const avgCharge = calculateAverageDailyGridCharge(providerConfig, batteryConfig, state);
        tableHTML += `<tr><td><strong>Average Daily Grid Charge</strong></td><td><strong>${avgCharge.toFixed(2)} kWh</strong></td></tr>`;
		const avgSocAt6am = calculateAverageSOCAt6am(providerConfig, batteryConfig, state);
		tableHTML += `<tr><td><strong>Average SOC at 6am</strong></td><td><strong>${avgSocAt6am.toFixed(1)}%</strong></td></tr>`;
        // --- END OF ADDED BLOCK ---
    });

    tableHTML += "</tbody></table>";
    if (debugContainer) debugContainer.innerHTML = tableHTML;
    if (debugContainer) debugContainer.style.display = "block";
}

export function renderAnalysisPeriodDebugTable() {
    if (!document.getElementById("debugToggle")?.checked) return;
    hideAllDebugContainers();
    const debugContainer = document.getElementById("analysisPeriodDebugTableContainer");
    let tableHTML = "<h3>Analysis Period Inputs</h3><table><tbody>";
    tableHTML += `<tr><td>Analysis Years (System Lifespan)</td><td>${getNumericInput("numYears", 15)}</td></tr>`;
    tableHTML += `<tr><td>Solar Degradation (% per year)</td><td>${getNumericInput("solarDegradation", 0.5)}</td></tr>`;
    tableHTML += `<tr><td>Battery Degradation (% per year)</td><td>${getNumericInput("batteryDegradation", 2)}</td></tr>`;
    tableHTML += "</tbody></table>";
    if (debugContainer) debugContainer.innerHTML = tableHTML;
    if (debugContainer) debugContainer.style.display = "block";
}

export function renderLoanDebugTable() {
    if (!document.getElementById("debugToggle")?.checked) return;
    hideAllDebugContainers();
    const debugContainer = document.getElementById("loanDebugTableContainer");
    const P = getNumericInput("loanAmount");
    const annualRate = getNumericInput("loanInterestRate");
    const termYears = getNumericInput("loanTerm");

    if (P === 0 || annualRate === 0 || termYears === 0) {
        if(debugContainer) debugContainer.innerHTML = "<p>Please enter valid loan details (Amount, Rate, and Term > 0).</p>";
        if(debugContainer) debugContainer.style.display = "block";
        return;
    }

    const i = (annualRate / 100) / 12;
    const n = termYears * 12;
    const monthlyPayment = P * (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
    const annualPayment = monthlyPayment * 12;

    let tableHTML = "<h3>Loan Amortization Schedule</h3><table><thead><tr><th>Year</th><th>Annual Repayment</th><th>Cumulative Repayments</th><th>Remaining Balance</th></tr></thead><tbody>";
    
    for (let y = 1; y <= termYears; y++) {
        let cumulativeRepayments = annualPayment * y;
        let yearEndBalance = P * (Math.pow(1 + i, n) - Math.pow(1 + i, y * 12)) / (Math.pow(1 + i, n) - 1);
        tableHTML += `<tr><td>${y}</td><td>$${annualPayment.toFixed(2)}</td><td>$${cumulativeRepayments.toFixed(2)}</td><td>$${Math.max(0, yearEndBalance).toFixed(2)}</td></tr>`;
    }
    tableHTML += "</tbody></table>";
    if(debugContainer) debugContainer.innerHTML = tableHTML;
    if(debugContainer) debugContainer.style.display = "block";
}

export function renderOpportunityCostDebugTable() {
    if (!document.getElementById("debugToggle")?.checked) return;
    hideAllDebugContainers();
    const debugContainer = document.getElementById("opportunityCostDebugTableContainer");
    const costSolar = getNumericInput("costSolar");
    const costBattery = getNumericInput("costBattery");
    const systemCost = costSolar + costBattery;
    const discountRate = getNumericInput("discountRate") / 100;
    const numYears = getNumericInput("numYears", 15);

    let tableHTML = `<h3>Opportunity Cost: Future Value of Initial Capital ($${systemCost.toFixed(2)})</h3><table><thead><tr><th>Year</th><th>Invested Capital Value</th></tr></thead><tbody>`;
    for (let y = 1; y <= numYears; y++) {
        const futureValue = systemCost * Math.pow(1 + discountRate, y);
        tableHTML += `<tr><td>${y}</td><td>$${futureValue.toFixed(2)}</td></tr>`;
    }
    tableHTML += "</tbody></table>";
    if(debugContainer) debugContainer.innerHTML = tableHTML;
    if(debugContainer) debugContainer.style.display = "block";
}
