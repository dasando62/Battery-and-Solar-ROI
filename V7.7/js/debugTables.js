// js/debugTables.js
// Version 7.7
import { getNumericInput } from './utils.js';
import { 
	generateHourlyConsumptionProfileFromDailyTOU, 
	generateHourlySolarProfileFromDaily 
} from './profiles.js';
import { simulateDay } from './analysis.js'; // Import the main simulation function instead
import { state } from './state.js';

function hideAllDebugContainers() {
    document.querySelectorAll('[id$="DebugTableContainer"]').forEach(el => el.style.display = "none");
}

export function renderDebugDataTable(state) {
    if (!document.getElementById("debugToggle")?.checked) return;
    const useManual = document.getElementById("manualInputToggle")?.checked;
    if (!useManual && (!state.electricityData || !state.solarData || state.electricityData.length === 0 || state.solarData.length === 0)) {
        alert("Please upload both electricity and solar CSV files with data first.");
        return;
    }
    hideAllDebugContainers();
    const debugContainer = document.getElementById("dataDebugTableContainer");
    let tableHTML = "<h3>Debug Data (First 100 entries)</h3><table><thead><tr><th>Date</th><th>Hour</th><th>Consumption (kWh)</th><th>Solar (kWh)</th></tr></thead><tbody>";
    const numEntries = useManual ? 1 : Math.min(state.electricityData.length, 100);
    for (let d = 0; d < numEntries; d++) {
        const dailyPeak = useManual ? getNumericInput("dailyPeak") : 0;
        const dailyShoulder = useManual ? getNumericInput("dailyShoulder") : 0;
        const dailyOffPeak = useManual ? getNumericInput("dailyOffPeak") : 0;
        const dailySolar = useManual ? getNumericInput("dailySolar") : (state.solarData?.[d]?.hourly.reduce((a, b) => a + b, 0) || 0);
        const hourlyConsumption = useManual ? generateHourlyConsumptionProfileFromDailyTOU(dailyPeak, dailyShoulder, dailyOffPeak) : state.electricityData[d].consumption;
        const hourlySolar = generateHourlySolarProfileFromDaily(dailySolar);
        for (let h = 0; h < 24; h++) {
            tableHTML += `<tr><td>${useManual ? "Manual Average" : state.electricityData[d].date}</td><td>${(h<10?'0':'')+h}:00</td><td>${(hourlyConsumption[h] || 0).toFixed(3)}</td><td>${(hourlySolar[h] || 0).toFixed(3)}</td></tr>`;
        }
        if (useManual) break;
    }
    tableHTML += "</tbody></table>";
    if (debugContainer) debugContainer.innerHTML = tableHTML;
    if (debugContainer) debugContainer.style.display = "block";
}

export function renderExistingSystemDebugTable(state) {
    if (!document.getElementById("debugToggle")?.checked) return;
    if (document.getElementById("manualInputToggle")?.checked || !state.electricityData || !state.solarData || state.electricityData.length === 0) {
        alert("This debug table requires uploaded CSV data.");
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
        alert("No overlapping data found between the two CSV files. Please ensure the date ranges are aligned.");
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
    
    const useManual = document.getElementById("manualInputToggle")?.checked;
    if (!useManual && (!state.electricityData || !state.solarData || state.electricityData.length === 0)) {
        alert("Please upload CSV data to see the detailed histogram analysis.");
    }
    hideAllDebugContainers();
    const debugContainer = document.getElementById("newSystemDebugTableContainer");

    const coverageTarget = getNumericInput('recommendationCoverageTarget', 90);
    const simulationData = useManual ? {
        'Q1_Summer': { avgPeak: getNumericInput("summerDailyPeak"), avgShoulder: getNumericInput("summerDailyShoulder"), avgOffPeak: getNumericInput("summerDailyOffPeak") },
        'Q2_Autumn': { avgPeak: getNumericInput("autumnDailyPeak"), avgShoulder: getNumericInput("autumnDailyShoulder"), avgOffPeak: getNumericInput("autumnDailyOffPeak") },
        'Q3_Winter': { avgPeak: getNumericInput("winterDailyPeak"), avgShoulder: getNumericInput("winterDailyShoulder"), avgOffPeak: getNumericInput("winterDailyOffPeak") },
        'Q4_Spring': { avgPeak: getNumericInput("springDailyPeak"), avgShoulder: getNumericInput("springDailyShoulder"), avgOffPeak: getNumericInput("springDailyOffPeak") },
    } : state.quarterlyAverages;

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

    if (!useManual && state.electricityData && state.solarData) {
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
			recommendationHTML += `
				<p class="input-explainer" style="margin-top: 10px;">
				<strong>Note:</strong> The <strong>Heuristic Sizing</strong> provides a general estimate based on the solar array size. The <strong>Detailed Sizing</strong> is a more precise calculation based on your actual peak power demand from your CSV data. The Detailed Sizing is the more accurate value for a custom-fit system.
				</p>`;
            
            // --- BLACKOUT LOGIC MOVED HERE ---
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

					// NEW: Find the next largest standard size
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
            // ... (rest of the histogram and chart logic remains here) ...
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
    const recommendationContainer = document.getElementById("recommendationContainer");
    if (recommendationContainer) recommendationContainer.innerHTML = recommendationHTML;
    
    if (debugContainer) debugContainer.style.display = "block";
}

export function renderProvidersDebugTable(state) {
    if (!document.getElementById("debugToggle")?.checked) return;
    hideAllDebugContainers();
    const debugContainer = document.getElementById("providersDebugTableContainer");
    let tableHTML = "<h3>Provider & Tariff Inputs</h3><table><tbody>";
    const providers = Array.from(document.querySelectorAll(".providerCheckbox:checked")).map(cb => cb.value);
    
    // Check if an analysis has been run and the required data is available
    if (!state.analysisConfig || !state.quarterlyAverages) {
        tableHTML += `<tr><td>Run an analysis first to see provider debug info.</td></tr>`;
        tableHTML += "</tbody></table>";
        if (debugContainer) debugContainer.innerHTML = tableHTML;
        if (debugContainer) debugContainer.style.display = "block";
        return;
    }

    if(state.quarterlyAverages) {
        tableHTML += `<tr><td colspan="2"><strong>Quarterly Averages (Daily, from CSV)</strong></td></tr>`;
        for (const quarter in state.quarterlyAverages) {
            const q = state.quarterlyAverages[quarter];
            tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Peak</td><td>${(q.avgPeak).toFixed(2)} kWh</td></tr>`;
            tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Shoulder</td><td>${(q.avgShoulder).toFixed(2)} kWh</td></tr>`;
            tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Off-Peak</td><td>${(q.avgOffPeak).toFixed(2)} kWh</td></tr>`;
            tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Solar</td><td>${(q.avgSolar).toFixed(2)} kWh</td></tr>`;
        }
    }
    
    providers.forEach(p => {
        tableHTML += `<tr><td colspan="2" class="provider-header-cell"><strong>${p}</strong></td></tr>`;

        const providerConfig = state.analysisConfig.providers[p];
        const batteryConfig = {
            capacity: getNumericInput("newBattery"),
            inverterKW: getNumericInput("newBatteryInverter")
        };
        const simulationData = state.quarterlyAverages;

        const avgCharge = calculateAverageDailyGridCharge(providerConfig, batteryConfig, simulationData);
        tableHTML += `<tr><td><strong>Average Daily Grid Charge</strong></td><td><strong>${avgCharge.toFixed(2)} kWh</strong></td></tr>`;

        const settingsDiv = document.getElementById(p.toLowerCase() + "Settings");
        if(settingsDiv) {
            settingsDiv.querySelectorAll('label').forEach(label => {
                const input = label.querySelector('input, select');
                const p = label.querySelector('p.input-explainer');
                if (p) return; 

                if(input) {
                    tableHTML += `<tr><td>${label.textContent.replace(':', '')}</td><td>${input.type === 'checkbox' ? input.checked : input.value}</td></tr>`;
                }
            });
        }
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
    if (!provider.gridCharge || !provider.gridCharge.enabled) {
        return 0;
    }

    let totalAnnualGridChargeKWh = 0;
    const daysPerQuarter = { 'Q1_Summer': 90, 'Q2_Autumn': 91, 'Q3_Winter': 92, 'Q4_Spring': 92 };

    for (const quarter in simulationData) {
        const qData = simulationData[quarter];
        if (!qData || typeof qData.avgPeak === 'undefined') continue;

        const hourlyConsumption = generateHourlyConsumptionProfileFromDailyTOU(qData.avgPeak, qData.avgShoulder, qData.avgOffPeak);
        
        // Use the imported simulateDay function
        const dailyBreakdown = simulateDay(hourlyConsumption, Array(24).fill(0), provider, batteryConfig);
        
        totalAnnualGridChargeKWh += dailyBreakdown.gridChargeKWh * daysPerQuarter[quarter];
    }

    return totalAnnualGridChargeKWh / 365;
}