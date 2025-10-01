// js/debugTables.js
// Version 1.0.3
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

export function createBreakdownTableHTML(title, data, provider, year, escalationRate, fitConfig, getDegradedFitRate) {
    const escalationFactor = Math.pow(1 + escalationRate, year - 1);
    const dailyCharge = provider.dailyCharge * escalationFactor;
    const peakRate = (provider.importRates.find(r => r.name === 'Peak')?.rate || 0) * escalationFactor;
    const shoulderRate = (provider.importRates.find(r => r.name === 'Shoulder')?.rate || 0) * escalationFactor;
    const offPeakRate = (provider.importRates.find(r => r.name === 'Off-Peak')?.rate || 0) * escalationFactor;

    let tier1ExportRate = 0;
    let tier2ExportRate = 0;
    const exportRule = provider.exportRates[0];

    if (exportRule?.type === 'tiered') {
        tier1ExportRate = getDegradedFitRate(exportRule.tiers[0]?.rate, year, fitConfig);
        tier2ExportRate = getDegradedFitRate(exportRule.tiers[1]?.rate, year, fitConfig);
    } else if (exportRule?.type === 'flat') {
        tier1ExportRate = getDegradedFitRate(exportRule.rate, year, fitConfig);
    }

    let totalDays = 0, totalPeakKWh = 0, totalShoulderKWh = 0, totalOffPeakKWh = 0;
    let totalTier1ExportKWh = 0, totalTier2ExportKWh = 0, totalGridChargeKWh = 0, totalGridChargeCost = 0;

    let tableHTML = `<h3>${title}</h3><table class="raw-data-table"><thead><tr><th>Period</th><th>Days</th><th>Supply Charge</th><th>Grid Charge (kWh)</th><th>Grid Charge Cost</th><th>Peak Import (kWh)</th><th>Peak Charge</th><th>Shoulder Import (kWh)</th><th>Shoulder Charge</th><th>Off-Peak Import (kWh)</th><th>Off-Peak Charge</th><th>Tier 1 Export (kWh)</th><th>Tier 1 Credit</th><th>Tier 2 Export (kWh)</th><th>Tier 2 Credit</th></tr></thead><tbody>`;

    for (const season of ['Summer', 'Autumn', 'Winter', 'Spring']) {
        const seasonData = data[season];
        if (!seasonData) continue;
        
        totalDays += seasonData.days;
        totalPeakKWh += seasonData.peakKWh;
        totalShoulderKWh += seasonData.shoulderKWh;
        totalOffPeakKWh += seasonData.offPeakKWh;
        // --- SAFE ACCESS START ---
        totalGridChargeKWh += seasonData.gridChargeKWh || 0;
        totalGridChargeCost += seasonData.gridChargeCost || 0;
        // --- SAFE ACCESS END ---

        let seasonalTier1Export = seasonData.tier1ExportKWh;
        let seasonalTier2Export = seasonData.tier2ExportKWh;
        if (exportRule?.type === 'flat') {
            seasonalTier1Export += seasonalTier2Export;
            seasonalTier2Export = 0;
        }
        totalTier1ExportKWh += seasonalTier1Export;
        totalTier2ExportKWh += seasonalTier2Export;

        tableHTML += `<tr>
            <td>${season}</td><td>${seasonData.days}</td>
            <td>$${(seasonData.days * dailyCharge).toFixed(2)}</td>
            <td>${(seasonData.gridChargeKWh || 0).toFixed(2)}</td>
            <td>$${(seasonData.gridChargeCost || 0).toFixed(2)}</td>
            <td>${seasonData.peakKWh.toFixed(2)}</td><td>$${(seasonData.peakKWh * peakRate).toFixed(2)}</td>
            <td>${seasonData.shoulderKWh.toFixed(2)}</td><td>$${(seasonData.shoulderKWh * shoulderRate).toFixed(2)}</td>
            <td>${seasonData.offPeakKWh.toFixed(2)}</td><td>$${(seasonData.offPeakKWh * offPeakRate).toFixed(2)}</td>
            <td>${seasonalTier1Export.toFixed(2)}</td><td>$${(seasonalTier1Export * tier1ExportRate).toFixed(2)}</td>
            <td>${seasonalTier2Export.toFixed(2)}</td><td>$${(seasonalTier2Export * tier2ExportRate).toFixed(2)}</td>
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

    const useManual = document.getElementById("manualInputToggle")?.checked;
    if (!useManual && (!state.electricityData || !state.solarData || state.electricityData.length === 0)) {
        displayError("Please upload both electricity and solar CSV files to use this debug tool.");
        return;
    }
    hideAllDebugContainers();
    const debugContainer = document.getElementById("newSystemDebugTableContainer");
    const recommendationContainer = document.getElementById("recommendationContainer");
    if (!recommendationContainer) return;

    // Get simulation data (calculating averages if needed)
    let simulationData;
    if (useManual) {
        simulationData = {
            'Q1_Summer': { avgPeak: getNumericInput("summerDailyPeak"), avgShoulder: getNumericInput("summerDailyShoulder"), avgOffPeak: getNumericInput("summerDailyOffPeak"), avgSolar: getNumericInput("summerDailySolar") },
            'Q2_Autumn': { avgPeak: getNumericInput("autumnDailyPeak"), avgShoulder: getNumericInput("autumnDailyShoulder"), avgOffPeak: getNumericInput("autumnDailyOffPeak"), avgSolar: getNumericInput("autumnDailySolar") },
            'Q3_Winter': { avgPeak: getNumericInput("winterDailyPeak"), avgShoulder: getNumericInput("winterDailyShoulder"), avgOffPeak: getNumericInput("winterDailyOffPeak"), avgSolar: getNumericInput("winterDailySolar") },
            'Q4_Spring': { avgPeak: getNumericInput("springDailyPeak"), avgShoulder: getNumericInput("springDailyShoulder"), avgOffPeak: getNumericInput("springDailyOffPeak"), avgSolar: getNumericInput("springDailySolar") },
        };
    } else {
        if (!state.quarterlyAverages) {
			            // 2. GET THE TOU HOURS FROM THE UI CONFIG
            const config = gatherConfigFromUI();
            const baselineProvider = config.providers[config.selectedProviders[0]];
            const touHours = {
                peak: baselineProvider.importData.peakHours || [],
                shoulder: baselineProvider.importData.shoulderHours || [],
			};
            state.quarterlyAverages = calculateQuarterlyAverages(state.electricityData, state.solarData, touHours);
        }
        simulationData = state.quarterlyAverages;
    }

    if (!simulationData) {
        recommendationContainer.innerHTML = '<p style="color: red;">Could not calculate seasonal averages from the provided data.</p>';
        if (debugContainer) debugContainer.style.display = "block";
        return;
    }

    const coverageTarget = getNumericInput('recommendationCoverageTarget', 90);
    const heuristicRecs = calculateSizingRecommendations(coverageTarget, simulationData);
    
    let recommendationHTML = `<div class="recommendation-section">`;
    if (heuristicRecs) {
        recommendationHTML += `
            <h4>Heuristic Sizing (based on ${coverageTarget}% annual coverage)</h4>
            <p>
                <strong>Recommended Solar: ${heuristicRecs.solar.toFixed(1)} kW</strong><br>
                <strong>Recommended Battery: ${heuristicRecs.battery.toFixed(1)} kWh</strong><br>
                <strong>Recommended Inverter: ${heuristicRecs.inverter.toFixed(1)} kW</strong>
            </p>
            <hr>`;
    }

    // Detailed Sizing (CSV only)
    if (!useManual) {
        const dailyPeakPeriodData = [];
        const dailyMaxHourData = [];
        let totalDays = 0;
        const newBatterySize = getNumericInput('newBattery', 0);
        const newBatteryInverter = getNumericInput('newBatteryInverter', 5);
        const existingSolarKW = getNumericInput('existingSolarKW', 0);
        const newSolarKW = getNumericInput('newSolarKW', 0);
        const replaceSystem = document.getElementById("replaceExistingSystem")?.checked;
        const totalSolarKW = replaceSystem ? newSolarKW : existingSolarKW + newSolarKW;
        const solarDataMap = new Map(state.solarData.map(day => [day.date, day.hourly]));
        state.electricityData.forEach(day => {
            const hourlySolarRaw = solarDataMap.get(day.date);
            if (!hourlySolarRaw) return;
            totalDays++;
            let dailyPeakPeriodKWh = 0;
            let dailyMaxHourKWh = 0;
            let batterySOC = 0;
            const solarProfileSourceKw = existingSolarKW > 0 ? existingSolarKW : 1;
            const hourlySolar = hourlySolarRaw.map(h => (h / solarProfileSourceKw) * totalSolarKW);
            for (let h = 0; h < 24; h++) {
                const consumption = day.consumption[h] || 0;
                const solar = hourlySolar[h] || 0;
                const selfConsumption = Math.min(consumption, solar);
                let remainingConsumption = consumption - selfConsumption;
                let excessSolar = solar - selfConsumption;
                dailyMaxHourKWh = Math.max(dailyMaxHourKWh, remainingConsumption);
                if (remainingConsumption > 0) {
                    const discharge = Math.min(remainingConsumption, batterySOC, newBatteryInverter);
                    batterySOC -= discharge;
                }
                if (excessSolar > 0) {
                    const charge = Math.min(excessSolar, newBatterySize - batterySOC, newBatteryInverter);
                    batterySOC += charge;
                }
                if ((h >= 7 && h < 10) || (h >= 16 && h < 22)) {
                    dailyPeakPeriodKWh += consumption;
                }
            }
            dailyPeakPeriodData.push(dailyPeakPeriodKWh);
            dailyMaxHourData.push(dailyMaxHourKWh);
        });
        if (totalDays > 0) {
            const getPercentile = (data, percentile) => {
                const sortedData = [...data].sort((a, b) => a - b);
                const index = Math.ceil(percentile * sortedData.length) - 1;
                return sortedData[Math.max(0, index)];
            };
            const recommendedBatteryKWh = getPercentile(dailyPeakPeriodData, 0.90);
            const recommendedInverterKW = getPercentile(dailyMaxHourData, 0.90);
            const finalBatteryRec = Math.ceil(recommendedBatteryKWh);
            const finalInverterRec = (Math.ceil(recommendedInverterKW * 2) / 2).toFixed(1);
            const batteryCoverageDays = dailyPeakPeriodData.filter(d => d <= finalBatteryRec).length;
            const inverterCoverageDays = dailyMaxHourData.filter(d => d <= finalInverterRec).length;
            recommendationHTML += `
                <h4>Detailed Sizing (based on 90th percentile of daily load)</h4>
                <p>
                    <strong>Recommended Battery Capacity: ${finalBatteryRec} kWh</strong><br>
                    <small><em>This would have fully covered peak period needs on ${batteryCoverageDays} of ${totalDays} days.</em></small>
                </p>
                <p>
                    <strong>Recommended Inverter Power: ${finalInverterRec} kW</strong><br>
                    <small><em>This would have met max power demand on ${inverterCoverageDays} of ${totalDays} days.</em></small>
                </p>`;
            const blackoutSizingEnabled = document.getElementById("enableBlackoutSizing").checked;
            if (blackoutSizingEnabled) {
                const blackoutDuration = getNumericInput('blackoutDuration', 0);
                const blackoutCoverage = getNumericInput('blackoutCoverage', 0) / 100;
                if (blackoutDuration > 0 && blackoutCoverage > 0) {
                    const allHours = state.electricityData.flatMap(d => d.consumption);
                    let maxConsumptionInWindow = 0;
                    for (let i = 0; i <= allHours.length - blackoutDuration; i++) {
                        const windowSum = allHours.slice(i, i + blackoutDuration).reduce((a, b) => a + b, 0);
                        if (windowSum > maxConsumptionInWindow) maxConsumptionInWindow = windowSum;
                    }
                    const requiredReserve = maxConsumptionInWindow * blackoutCoverage;
                    const totalCalculatedSize = finalBatteryRec + requiredReserve;
                    const standardSizes = [5, 10, 13.5, 16, 20, 24, 32, 40, 48];
                    const practicalSize = standardSizes.find(size => size >= totalCalculatedSize) || Math.ceil(totalCalculatedSize);
                    recommendationHTML += `<hr>
                        <h4>Blackout Protection Sizing</h4>
                        <p>
                            For a <strong>${blackoutDuration}-hour</strong> blackout covering <strong>${blackoutCoverage * 100}%</strong> of usage, a reserve of <strong>${requiredReserve.toFixed(2)} kWh</strong> is needed.
                        </p>
                        <p>
                            <strong>Total Recommended Practical Size (Savings + Blackout):</strong><br>
                            ${finalBatteryRec} kWh + ${requiredReserve.toFixed(2)} kWh = ${totalCalculatedSize.toFixed(2)} kWh.
                            The next largest standard size is <strong>${practicalSize} kWh</strong>.
                        </p>`;
                }
            }
            const newSystemEstimatesTable = document.getElementById("newSystemEstimatesTable");
            if (newSystemEstimatesTable) {
                newSystemEstimatesTable.innerHTML = `<details class="collapsible-histogram"><summary>📊 Daily Peak Period Load Distribution</summary><canvas id="peakPeriodHistogram"></canvas></details><details class="collapsible-histogram"><summary>📊 Daily Maximum Hourly Load Distribution</summary><canvas id="maxHourlyHistogram"></canvas></details>`;
            }
            const maxPeakPeriod = Math.max(...dailyPeakPeriodData);
            const binSize1 = Math.ceil(maxPeakPeriod / 10) || 1;
            const bins1 = Array.from({ length: 10 }, (_, i) => ({ label: `${i * binSize1}-${(i + 1) * binSize1} kWh`, count: 0 }));
            dailyPeakPeriodData.forEach(v => { const binIndex = Math.min(Math.floor(v / binSize1), 9); if (bins1[binIndex]) bins1[binIndex].count++; });
            const maxHourly = Math.max(...dailyMaxHourData);
            const binSize2 = Math.ceil(maxHourly / 10 * 10) / 10 || 1;
            const bins2 = Array.from({ length: 10 }, (_, i) => ({ label: `${(i * binSize2).toFixed(1)}-${((i + 1) * binSize2).toFixed(1)} kW`, count: 0 }));
            dailyMaxHourData.forEach(v => { const binIndex = Math.min(Math.floor(v / binSize2), 9); if (bins2[binIndex]) bins2[binIndex].count++; });
            if (state.peakPeriodChart) state.peakPeriodChart.destroy();
            const ctx1 = document.getElementById("peakPeriodHistogram")?.getContext("2d");
            if (ctx1) { state.peakPeriodChart = new Chart(ctx1, { type: 'bar', data: { labels: bins1.map(b => b.label), datasets: [{ label: "Days", data: bins1.map(b => b.count), backgroundColor: "rgba(54,162,235,0.6)" }] }, options: { plugins: { title: { display: true, text: 'Peak Period Demand Histogram' } } } }); }
            if (state.maxHourlyChart) state.maxHourlyChart.destroy();
            const ctx2 = document.getElementById("maxHourlyHistogram")?.getContext("2d");
            if(ctx2) { state.maxHourlyChart = new Chart(ctx2, { type: 'bar', data: { labels: bins2.map(b => b.label), datasets: [{ label: "Days", data: bins2.map(b => b.count), backgroundColor: "rgba(255,159,64,0.6)" }] }, options: { plugins: { title: { display: true, text: 'Maximum Hourly Load Histogram' } } } }); }
        }
    }
    recommendationHTML += `</div>`;
    recommendationContainer.innerHTML = recommendationHTML;
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
        const avgCharge = calculateAverageDailyGridCharge(providerConfig, batteryConfig, simulationData);
        tableHTML += `<tr><td><strong>Average Daily Grid Charge</strong></td><td><strong>${avgCharge.toFixed(2)} kWh</strong></td></tr>`;
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

export function calculateAverageDailyGridCharge(provider, batteryConfig, simulationData) {
    // Updated to use the new top-level property
    if (!provider.gridChargeEnabled) {
        return 0;
    }

    let totalAnnualGridChargeKWh = 0;
    const daysPerQuarter = { 'Q1_Summer': 90, 'Q2_Autumn': 91, 'Q3_Winter': 92, 'Q4_Spring': 92 };

    for (const quarter in simulationData) {
        const qData = simulationData[quarter];
        if (!qData || typeof qData.avgPeak === 'undefined') continue;

        const hourlyConsumption = generateHourlyConsumptionProfileFromDailyTOU(qData.avgPeak, qData.avgShoulder, qData.avgOffPeak);
        
        // Use an empty solar profile, as we only want to measure grid charging potential
        const dailyBreakdown = simulateDay(hourlyConsumption, Array(24).fill(0), provider, batteryConfig).dailyBreakdown;
        
        if (daysPerQuarter[quarter]) {
            totalAnnualGridChargeKWh += (dailyBreakdown.gridChargeKWh || 0) * daysPerQuarter[quarter];
        }
    }

    return totalAnnualGridChargeKWh > 0 ? totalAnnualGridChargeKWh / 365 : 0;
}