// js/analysis.js
//Version 9.5
import { state } from './state.js';
import { escalate } from './utils.js';
import { tariffComponents } from './tariffComponents.js';
import { getNumericInput } from './utils.js';
import { generateHourlyConsumptionProfileFromDailyTOU, generateHourlySolarProfileFromDaily } from './profiles.js';

// --- COMPLETE HELPER FUNCTIONS ---

function getRateForHour(hour, rates) {
    for (const rateInfo of rates) {
        if (rateInfo.hours.length > 0 && rateInfo.hours.includes(hour)) {
            return rateInfo.rate;
        }
    }
    const otherRule = rates.find(r => r.hours.length === 0);
    return otherRule ? otherRule.rate : 0;
}

function getFitDegradationConfig() {
    return {
        startYear: getNumericInput("fitDegradationStartYear", 1),
        endYear: getNumericInput("fitDegradationEndYear", 10),
        minRate: getNumericInput("fitMinimumRate", 0.03) // Assuming positive credit
    };
}

export function getDegradedFitRate(baseRate, year, fitConfig) {
    if (typeof baseRate !== 'number') return 0;
    const { startYear, endYear, minRate } = fitConfig;
    if (year < startYear) return baseRate;
    if (year >= endYear) return minRate;

    // Ensure endYear is greater than startYear to avoid division by zero
    if (endYear <= startYear) return baseRate;

    const progress = (year - startYear) / (endYear - startYear);
    return baseRate - (progress * (baseRate - minRate));
}

export function calculateSizingRecommendations(coverageTarget, simulationData) {
    if (!simulationData || Object.keys(simulationData).length === 0) {
        return { solar: 0, battery: 0, inverter: 0, coverageTarget: coverageTarget };
    }
    const daysPerQuarter = { 'Q1_Summer': 90, 'Q2_Autumn': 91, 'Q3_Winter': 92, 'Q4_Spring': 92 };
    let totalKWh = 0, totalEveningKWh = 0, totalDays = 0;

    for (const quarter in simulationData) {
        if(simulationData[quarter]){
            const q = simulationData[quarter];
            const daysInQ = daysPerQuarter[quarter];
            totalKWh += (q.avgPeak + q.avgShoulder + q.avgOffPeak) * daysInQ;
            totalEveningKWh += (q.avgPeak + q.avgOffPeak) * daysInQ;
            totalDays += daysInQ;
        }
    }
    
    const avgDailyConsumption = totalDays > 0 ? totalKWh / totalDays : 0;
    const totalAnnualKWh = avgDailyConsumption * 365;
    const avgDailyEveningConsumption = totalDays > 0 ? totalEveningKWh / totalDays : 0;
    const avgDailyGenerationPerKW = 4.0;
    const targetAnnualGeneration = totalAnnualKWh * (coverageTarget / 100);
    let recommendedSolarKW = targetAnnualGeneration / (avgDailyGenerationPerKW * 365);
    recommendedSolarKW = Math.round(recommendedSolarKW * 2) / 2;

    const scalingFactor = coverageTarget / 90;
    const targetEveningConsumption = avgDailyEveningConsumption * scalingFactor;
    
    let recommendedBatteryKWh;
    if (targetEveningConsumption <= 5) recommendedBatteryKWh = 5;
    else if (targetEveningConsumption <= 10) recommendedBatteryKWh = 10;
    else if (targetEveningConsumption <= 13.5) recommendedBatteryKWh = 13.5;
    else recommendedBatteryKWh = Math.round(targetEveningConsumption);

    let recommendedInverterKW;
    if (recommendedSolarKW <= 6.6) recommendedInverterKW = 5;
    else if (recommendedSolarKW <= 10) recommendedInverterKW = 8;
    else recommendedInverterKW = 10;

    return { solar: recommendedSolarKW, battery: recommendedBatteryKWh, inverter: recommendedInverterKW, coverageTarget: coverageTarget };
}

function simulateBatteryDay(hourlyConsumption, hourlySolar, batteryConfig) {
    let batterySOC = 0;
    const hourlyImports = Array(24).fill(0);
    const hourlyExports = Array(24).fill(0);

    for (let h = 0; h < 24; h++) {
        const consumption = hourlyConsumption[h] || 0;
        const solar = hourlySolar[h] || 0;
        const selfConsumption = Math.min(consumption, solar);
        let remainingConsumption = consumption - selfConsumption;
        let excessSolar = solar - selfConsumption;
        if (remainingConsumption > 0) {
            const dischargeable = Math.min(batterySOC, batteryConfig.inverterKW);
            const discharge = Math.min(remainingConsumption, dischargeable);
            batterySOC -= discharge;
            remainingConsumption -= discharge;
        }
        if (excessSolar > 0) {
            const chargeable = Math.min(batteryConfig.capacity - batterySOC, batteryConfig.inverterKW);
            const charge = Math.min(excessSolar, chargeable);
            batterySOC += charge;
            excessSolar -= charge;
        }
        hourlyImports[h] = remainingConsumption;
        hourlyExports[h] = excessSolar;
    }
    return { finalHourlyConsumption: hourlyImports, finalHourlyExports: hourlyExports };
}

export function simulateDay(hourlyConsumption, hourlySolar, provider, batteryConfig = null, startingSOC = 0) {
    const results = {
        peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0,
        tier1ExportKWh: 0, tier2ExportKWh: 0,
        gridChargeKWh: 0, gridChargeCost: 0,
        hourlyExports: Array(24).fill(0)
    };
    
    // Declare batterySOC here, in the main function scope
    let batterySOC = startingSOC;

    if (!batteryConfig) {
        // --- NO BATTERY SCENARIO ---
        const finalHourlyConsumption = Array(24).fill(0);
        for (let h = 0; h < 24; h++) {
            const net = (hourlyConsumption[h] || 0) - (hourlySolar[h] || 0);
            if (net > 0) finalHourlyConsumption[h] = net;
            else results.hourlyExports[h] = -net;
        }
        const peakHours = provider.importData.peakHours || [];
        const shoulderHours = provider.importData.shoulderHours || [];
        for (let h = 0; h < 24; h++) {
            if (finalHourlyConsumption[h] > 0) {
                if (peakHours.includes(h)) results.peakKWh += finalHourlyConsumption[h];
                else if (shoulderHours.includes(h)) results.shoulderKWh += finalHourlyConsumption[h];
                else results.offPeakKWh += finalHourlyConsumption[h];
            }
        }
    } else {
        // --- WITH BATTERY SCENARIO ---
        // The declaration "let batterySOC = startingSOC;" is now moved above.
        const finalHourlyImports = Array(24).fill(0);
        const gridChargeImports = Array(24).fill(0);

        for (let h = 0; h < 24; h++) {
            const consumption = hourlyConsumption[h] || 0;
            const solar = hourlySolar[h] || 0;

            const selfConsumption = Math.min(consumption, solar);
            let remainingConsumption = consumption - selfConsumption;
            let excessSolar = solar - selfConsumption;
            if (excessSolar > 0) {
                const chargeFromSolar = Math.min(excessSolar, batteryConfig.capacity - batterySOC, batteryConfig.inverterKW);
                batterySOC += chargeFromSolar;
                excessSolar -= chargeFromSolar;
            }
            results.hourlyExports[h] = excessSolar;

            if (remainingConsumption > 0) {
                const discharge = Math.min(remainingConsumption, batterySOC, batteryConfig.inverterKW);
                batterySOC -= discharge;
                remainingConsumption -= discharge;
            }
            finalHourlyImports[h] = remainingConsumption;

            const gridChargeSettings = provider;
            const startHour = gridChargeSettings.gridChargeStart;
            const endHour = gridChargeSettings.gridChargeEnd;
            let inChargeWindow = false;
            if (startHour > endHour) {
                if (h >= startHour || h < endHour) inChargeWindow = true;
            } else {
                if (h >= startHour && h < endHour) inChargeWindow = true;
            }
            if (gridChargeSettings.gridChargeEnabled && inChargeWindow && batterySOC < (batteryConfig.socChargeTrigger / 100) * batteryConfig.capacity) {
                const chargeNeeded = batteryConfig.capacity * (batteryConfig.gridChargeThreshold / 100) - batterySOC;
                const chargeFromGrid = Math.min(chargeNeeded, batteryConfig.inverterKW);
                if (chargeFromGrid > 0) {
                    batterySOC += chargeFromGrid;
                    gridChargeImports[h] = chargeFromGrid;
                }
            }
        }

        const peakHours = provider.importData.peakHours || [];
        const shoulderHours = provider.importData.shoulderHours || [];
        const offPeakRate = provider.importData.offPeak || 0;
        for (let h = 0; h < 24; h++) {
            const normalImport = finalHourlyImports[h];
            const gridChargeImport = gridChargeImports[h];
            if (normalImport > 0) {
                if (peakHours.includes(h)) results.peakKWh += normalImport;
                else if (shoulderHours.includes(h)) results.shoulderKWh += normalImport;
                else results.offPeakKWh += normalImport;
            }
            if (gridChargeImport > 0) {
                results.gridChargeKWh += gridChargeImport;
                results.offPeakKWh += gridChargeImport;
                results.gridChargeCost += gridChargeImport * offPeakRate;
            }
        }
    }

    const dailyTotalExport = results.hourlyExports.reduce((a, b) => a + b, 0);
    const exportRule = provider.exportRates ? provider.exportRates[0] : null;
    if (exportRule) {
        const tier1Limit = exportRule.type === 'tiered' ? exportRule.tiers[0].limit : dailyTotalExport;
        results.tier1ExportKWh = Math.min(dailyTotalExport, tier1Limit);
        results.tier2ExportKWh = Math.max(0, dailyTotalExport - tier1Limit);
    }
    
    // The 'batterySOC' variable is now accessible here
    return { dailyBreakdown: results, finalSOC: batterySOC };
}
export function calculateDetailedSizing(correctedElectricityData, solarData, config, simulationData) {
    if (!correctedElectricityData || !solarData) return null;

    let peakHours = [];
    if (config.selectedProviders && config.selectedProviders.length > 0) {
        const baselineProviderKey = config.selectedProviders[0];
        const baselineProvider = config.providers[baselineProviderKey];
        if (baselineProvider && baselineProvider.importData) {
            peakHours = baselineProvider.importData.peakHours || [];
        }
    }

    const totalSolarKW = config.replaceExistingSystem ? config.newSolarKW : config.existingSolarKW + config.newSolarKW;
    const solarProfileSourceKw = config.existingSolarKW > 0 ? config.existingSolarKW : 1;
    const solarDataMap = new Map(solarData.map(day => [day.date, day.hourly]));
    const dailyPeakPeriodData = [];
    const dailyMaxHourData = [];
    let totalDays = 0;

    correctedElectricityData.forEach(day => {
        const hourlySolarRaw = solarDataMap.get(day.date);
        if (!hourlySolarRaw) return;
        totalDays++;
        let dailyPeakPeriodKWh = 0;
        let dailyMaxHourKWh = 0;
        const hourlySolar = hourlySolarRaw.map(h => (h / solarProfileSourceKw) * totalSolarKW);
        for (let h = 0; h < 24; h++) {
            const consumption = day.consumption[h] || 0;
            const solar = hourlySolar[h] || 0;
            const selfConsumption = Math.min(consumption, solar);
            const remainingConsumption = consumption - selfConsumption;
            dailyMaxHourKWh = Math.max(dailyMaxHourKWh, remainingConsumption);
            if (peakHours.includes(h)) {
                dailyPeakPeriodKWh += consumption;
            }
        }
        dailyPeakPeriodData.push(dailyPeakPeriodKWh);
        dailyMaxHourData.push(dailyMaxHourKWh);
    });

    if (totalDays === 0) return null;

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

    let blackoutResults = null;
    if (config.blackoutSizingEnabled) {
        const allHours = correctedElectricityData.flatMap(d => d.consumption);
        let maxConsumptionInWindow = 0;
        for (let i = 0; i <= allHours.length - config.blackoutDuration; i++) {
            const windowSum = allHours.slice(i, i + config.blackoutDuration).reduce((a, b) => a + b, 0);
            if (windowSum > maxConsumptionInWindow) maxConsumptionInWindow = windowSum;
        }
        const requiredReserve = maxConsumptionInWindow * config.blackoutCoverage;
        const totalCalculatedSize = finalBatteryRec + requiredReserve;
        const standardSizes = [5, 10, 13.5, 16, 20, 24, 32, 40, 48];
        const practicalSize = standardSizes.find(size => size >= totalCalculatedSize) || Math.ceil(totalCalculatedSize);
        blackoutResults = { requiredReserve, totalCalculatedSize, practicalSize, duration: config.blackoutDuration, coverage: config.blackoutCoverage };
    }

    // --- HISTOGRAM 1 ---
    const maxPeakPeriod = Math.max(...dailyPeakPeriodData);
    const binSize1 = Math.ceil(maxPeakPeriod / 10) || 1;
    const bins1 = Array.from({ length: 10 }, (_, i) => ({ label: `${i * binSize1}-${(i + 1) * binSize1} kWh`, count: 0 }));
    dailyPeakPeriodData.forEach(v => {
        const binIndex = Math.min(Math.floor(v / binSize1), 9);
        if (bins1[binIndex]) bins1[binIndex].count++;
    });

    // --- HISTOGRAM 2 ---
    const maxHourly = Math.max(...dailyMaxHourData);
    const binSize2 = Math.ceil(maxHourly / 10) || 1;
    const bins2 = Array.from({ length: 10 }, (_, i) => ({ label: `${i * binSize2}-${(i + 1) * binSize2} kW`, count: 0 }));
    dailyMaxHourData.forEach(v => {
        const binIndex = Math.min(Math.floor(v / binSize2), 9);
        if (bins2[binIndex]) bins2[binIndex].count++;
    });

    // --- FINAL RETURN OBJECT ---
    // All calculations are finished, NOW we can create the final object and return it.
    const finalReturnObject = {
        heuristic: calculateSizingRecommendations(config.recommendationCoverageTarget, simulationData),
        detailed: {
            recommendedBatteryKWh: finalBatteryRec,
            batteryCoverageDays: batteryCoverageDays,
            recommendedInverterKW: finalInverterRec,
            inverterCoverageDays: inverterCoverageDays,
            totalDays: totalDays,
        },
        blackout: blackoutResults,
        histogramData: {
            peakPeriod: bins1,
            maxHourly: bins2
        }
    };

    return finalReturnObject;
}

export function runSimulation(config, simulationData, electricityData) {
    const solarDegradationFactors = Array.from({ length: config.numYears + 1 }, (_, i) => Math.pow(1 - config.solarDegradation, i));
    const batteryDegradationFactors = Array.from({ length: config.numYears + 1 }, (_, i) => Math.pow(1 - config.batteryDegradation, i));
    const fitConfig = getFitDegradationConfig();

    // --- SETUP RESULTS OBJECTS ---
    const finalResults = { baselineCosts: {} };
    const rawData = { baseline: { year1: {}, year2: {} }, system: {} };
    config.selectedProviders.forEach(p => {
        finalResults[p] = { annualCosts: [], cumulativeSavingsPerYear: [], npv: 0, roiYear: null };
        rawData.system[p] = { year1: {}, year2: {} };
        for (const q of ['Summer', 'Autumn', 'Winter', 'Spring']) {
            rawData.system[p].year1[q] = { days: 0, peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0, tier1ExportKWh: 0, tier2ExportKWh: 0, gridChargeKWh: 0, gridChargeCost: 0 };
            rawData.system[p].year2[q] = { days: 0, peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0, tier1ExportKWh: 0, tier2ExportKWh: 0, gridChargeKWh: 0, gridChargeCost: 0 };
        }
    });

    const baselineProvider = config.providers[config.selectedProviders[0]];
    let annualizedBaseCost = 0;

    // --- 1. BASELINE CALCULATION (using raw CSV data) ---
    if (!config.useManual && electricityData) {
        let totalCostForPeriod = 0;
        let daysProcessed = 0;
        const peakHours = baselineProvider.importData.peakHours || [];
        const shoulderHours = baselineProvider.importData.shoulderHours || [];
        
        for (const q of ['Summer', 'Autumn', 'Winter', 'Spring']) {
            rawData.baseline.year1[q] = { days: 0, peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0, tier1ExportKWh: 0, tier2ExportKWh: 0 };
        }

        electricityData.forEach(day => {
            daysProcessed++;
            let dailyBreakdown = { peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0, tier1ExportKWh: 0, tier2ExportKWh: 0 };
            let dailyTotalExport = day.feedIn.reduce((a, b) => a + b, 0);

            for (let h = 0; h < 24; h++) {
                const gridImport = day.consumption[h] || 0;
                if (gridImport > 0) {
                    if (peakHours.includes(h)) dailyBreakdown.peakKWh += gridImport;
                    else if (shoulderHours.includes(h)) dailyBreakdown.shoulderKWh += gridImport;
                    else dailyBreakdown.offPeakKWh += gridImport;
                }
            }
            const exportRule = baselineProvider.exportRates[0];
            const tier1Limit = (exportRule.type === 'tiered' ? exportRule.tiers[0].limit : Infinity);
            dailyBreakdown.tier1ExportKWh = Math.min(dailyTotalExport, tier1Limit);
            dailyBreakdown.tier2ExportKWh = Math.max(0, dailyTotalExport - tier1Limit);
            
            const importCalculator = tariffComponents[baselineProvider.importComponent].calculate;
            const exportCalculator = tariffComponents[baselineProvider.exportComponent].calculate;
            let dailyEnergyCost = importCalculator(baselineProvider.importData, dailyBreakdown, { rate: 0, year: 1 });
            dailyEnergyCost -= exportCalculator(baselineProvider.exportData, dailyBreakdown, 1, fitConfig, getDegradedFitRate, getRateForHour);
            totalCostForPeriod += baselineProvider.dailyCharge + dailyEnergyCost;

            const month = parseInt(day.date.split('-')[1], 10);
            const season = [12,1,2].includes(month) ? 'Summer' : [3,4,5].includes(month) ? 'Autumn' : [6,7,8].includes(month) ? 'Winter' : 'Spring';
            const rawSeason = rawData.baseline.year1[season];
            if(rawSeason){
                Object.keys(dailyBreakdown).forEach(k => rawSeason[k] += dailyBreakdown[k]);
                rawSeason.days++;
            }
        });

        const annualizationFactor = daysProcessed > 0 ? 365 / daysProcessed : 0;
        annualizedBaseCost = totalCostForPeriod * annualizationFactor;
        rawData.baseline.year2 = JSON.parse(JSON.stringify(rawData.baseline.year1));
    }
    
    // --- MAIN ANNUAL LOOP ---
    for (let y = 1; y <= config.numYears; y++) {
        const solarFactor = solarDegradationFactors[y - 1];
        const batteryFactor = batteryDegradationFactors[y - 1];
        finalResults.baselineCosts[y] = escalate(annualizedBaseCost, config.tariffEscalation, y);

        config.selectedProviders.forEach(p => {
            const providerData = config.providers[p];
            let annualCost = 0;
            let totalDaysProcessed = 0;
            
            // Initialize the battery charge ONCE per year
            let currentSOC = 0; 
            
            if (!config.useManual && electricityData) {
                const solarDataMap = new Map(state.solarData.map(day => [day.date, day.hourly]));
                const totalSystemKw = config.replaceExistingSystem ? config.newSolarKW : config.existingSolarKW + config.newSolarKW;
                const solarProfileSourceKw = config.existingSolarKW > 0 ? config.existingSolarKW : 1;

                // Loop through each actual day
                electricityData.forEach(day => {
                    const hourlySolarRaw = solarDataMap.get(day.date);
                    if (!hourlySolarRaw) return;
                    totalDaysProcessed++;

                    // Calculate the home's TRUE consumption before simulating the new system
                    const trueHourlyConsumption = Array(24).fill(0);
                    for (let h = 0; h < 24; h++) {
                        const gridImport = day.consumption[h] || 0;
                        const gridExport = day.feedIn[h] || 0;
                        const originalSolar = hourlySolarRaw[h] || 0;
                        const selfConsumed = Math.max(0, originalSolar - gridExport);
                        trueHourlyConsumption[h] = gridImport + selfConsumed;
                    }

                    const newHourlySolar = hourlySolarRaw.map(h => (h / solarProfileSourceKw) * totalSystemKw * solarFactor);
                    const batteryConfig = {
                        capacity: (config.newBatteryKWH * batteryFactor),
                        inverterKW: config.newBatteryInverterKW,
                        gridChargeThreshold: config.gridChargeThreshold,
                        socChargeTrigger: config.socChargeTrigger
                    };
                    
                    // Pass the current charge and get the final charge back
                    const simResults = simulateDay(trueHourlyConsumption, newHourlySolar, providerData, batteryConfig, currentSOC);
                    const dailyBreakdown = simResults.dailyBreakdown;
                    currentSOC = simResults.finalSOC; // Update the charge for the next day's loop

                    const escalationConfig = { rate: config.tariffEscalation, year: y };
                    const importCalculator = tariffComponents[providerData.importComponent].calculate;
                    const exportCalculator = tariffComponents[providerData.exportComponent].calculate;
                    let dailyEnergyCost = dailyBreakdown.gridChargeCost || 0;
                    dailyEnergyCost += importCalculator(providerData.importData, dailyBreakdown, escalationConfig);
                    dailyEnergyCost -= exportCalculator(providerData.exportData, dailyBreakdown, y, fitConfig, getDegradedFitRate, getRateForHour);
                    const dailySupplyCharge = (providerData.dailyCharge || 0);
                    annualCost += escalate(dailySupplyCharge, config.tariffEscalation, y) + dailyEnergyCost;
                    
                    if (y <= 2) {
                        const month = parseInt(day.date.split('-')[1], 10);
                        const season = [12,1,2].includes(month) ? 'Summer' : [3,4,5].includes(month) ? 'Autumn' : [6,7,8].includes(month) ? 'Winter' : 'Spring';
                        const yearKey = y === 1 ? 'year1' : 'year2';
                        const rawSeason = rawData.system[p][yearKey][season];
                        if (rawSeason) {
                           Object.keys(dailyBreakdown).forEach(k => rawSeason[k] += dailyBreakdown[k]);
                           rawSeason.days++;
                        }
                    }
                });
                const annualizationFactor = totalDaysProcessed > 0 ? 365 / totalDaysProcessed : 0;
                annualCost = annualCost * annualizationFactor;
            }

            const finalAnnualCost = annualCost + escalate((providerData.monthlyFee || 0) * 12, config.tariffEscalation, y);
            finalResults[p].annualCosts.push(finalAnnualCost);
            
            const annualSavings = finalResults.baselineCosts[y] - finalAnnualCost;
            const systemCostForProvider = config.initialSystemCost - (providerData.rebate || 0);
            const netCashFlow = annualSavings - (y <= config.loanTerm ? config.annualLoanRepayment : 0);
            const lastYearCumulative = finalResults[p].cumulativeSavingsPerYear[y - 2] || 0;
            const currentCumulative = lastYearCumulative + netCashFlow;
            finalResults[p].cumulativeSavingsPerYear.push(currentCumulative);

            if (!finalResults[p].roiYear && currentCumulative >= systemCostForProvider) {
                finalResults[p].roiYear = y;
            }
            if (config.discountRateEnabled) {
                finalResults[p].npv += netCashFlow / Math.pow(1 + config.discountRate, y);
            }
        });
    }

    return { financials: finalResults, rawData: rawData, config: config };
}
