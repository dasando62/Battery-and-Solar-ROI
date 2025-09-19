// js/analysis.js
// V7.7 - Refactored as a pure calculation engine

import { tariffComponents } from './tariffComponents.js';
import { generateHourlyConsumptionProfileFromDailyTOU, generateHourlySolarProfileFromDaily } from './profiles.js';
import { getNumericInput } from './utils.js';

// --- HELPER FUNCTIONS ---

function getRateForHour(hour, rates) {
    // First, try to match specific hours
    for (const rateInfo of rates) {
        if (rateInfo.hours.length > 0 && rateInfo.hours.includes(hour)) {
            return rateInfo.rate;
        }
    }
    // If no specific match was found, find the first "Other" rule with empty hours
    const otherRule = rates.find(r => r.hours.length === 0);
    return otherRule ? otherRule.rate : 0;
}

function getFitDegradationConfig() {
    return {
        startYear: getNumericInput("fitDegradationStartYear", 1),
        endYear: getNumericInput("fitDegradationEndYear", 10),
        minRate: getNumericInput("fitMinimumRate", -0.03)
    };
}

function getDegradedFitRate(baseRate, year, fitConfig) {
    if (typeof baseRate !== 'number') return 0;
    const { startYear, endYear, minRate } = fitConfig;
    if (year < startYear) return baseRate;
    if (year >= endYear) return minRate;
    const progress = (year - startYear) / (endYear - startYear);
    return baseRate - (progress * (baseRate - minRate));
}

export function simulateDay(hourlyConsumption, hourlySolar, provider, batteryConfig = null, escalationFactor = 1) {
    let batterySOC = 0;
    const results = {
        peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0,
        tier1ExportKWh: 0, tier2ExportKWh: 0,
        gridChargeKWh: 0, gridChargeCost: 0,
        hourlyExports: Array(24).fill(0)
    };

    let finalHourlyConsumption = Array(24).fill(0);
    let finalHourlyExports = Array(24).fill(0);

    if (batteryConfig) {
        if (provider.gridCharge && provider.gridCharge.enabled) {
            const chargeLimit = batteryConfig.capacity * (batteryConfig.gridChargeThreshold / 100);
            const startTime = provider.gridCharge.startTime;
            let endTime = (provider.gridCharge.endTime.toLowerCase() === 'threshold') ? 99 : parseInt(provider.gridCharge.endTime, 10);
            if (isNaN(endTime)) endTime = startTime;

            for (let h = 0; h < 24; h++) {
                if (batterySOC >= chargeLimit) break;
                const currentHour = (startTime + h) % 24;
                const chargingWindowActive = (startTime < endTime) ? (currentHour >= startTime && currentHour < endTime) : (currentHour >= startTime || currentHour < endTime);
                if (!chargingWindowActive && endTime !== 99) break;

                const chargeNeeded = chargeLimit - batterySOC;
                const chargeAmount = Math.min(chargeNeeded, batteryConfig.inverterKW);
                batterySOC += chargeAmount;
                results.gridChargeKWh += chargeAmount;
                const rateForChargeHour = getRateForHour(currentHour, provider.importRates);
                results.gridChargeCost += chargeAmount * rateForChargeHour;
            }
        }
        
        const hourlyImports = Array(24).fill(0);
        for (let h = 0; h < 24; h++) {
            const consumption = hourlyConsumption[h];
            const solar = hourlySolar[h];
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
            finalHourlyExports[h] = excessSolar;
        }
        finalHourlyConsumption = hourlyImports;
    } else {
        // Corrected baseline logic
        for (let h = 0; h < 24; h++) {
            const net = hourlyConsumption[h] - hourlySolar[h];
            if (net > 0) {
                finalHourlyConsumption[h] = net; // Only count grid imports
            } else {
                finalHourlyConsumption[h] = 0; // No grid import
                finalHourlyExports[h] = -net;
            }
        }
    }

    results.hourlyExports = finalHourlyExports;
    let dailyTotalExport = 0;
    for (let h = 0; h < 24; h++) {
        const netLoad = finalHourlyConsumption[h];
        if (netLoad > 0) {
            if (provider.importRates.find(r => r.name === 'Peak' && r.hours.includes(h))) {
                results.peakKWh += netLoad;
            } else if (provider.importRates.find(r => r.name === 'Shoulder' && r.hours.includes(h))) {
                results.shoulderKWh += netLoad;
            } else {
                results.offPeakKWh += netLoad;
            }
        }
        dailyTotalExport += finalHourlyExports[h];
    }

    const tier1LimitRule = provider.exportRates.find(r => r.type === 'tiered');
    const tier1Limit = tier1LimitRule ? tier1LimitRule.tiers[0].limit : dailyTotalExport;
    results.tier1ExportKWh = Math.min(dailyTotalExport, tier1Limit);
    results.tier2ExportKWh = Math.max(0, dailyTotalExport - tier1Limit);

    return results;
}


export function runSimulation(config, simulationData) {
	// ADD THIS LINE AT THE VERY TOP
    console.log("runSimulation has started. Config received:", config, "Simulation Data received:", simulationData);
    const fitConfig = getFitDegradationConfig();
    const baselineProviderName = config.selectedProviders[0];
    const baselineProviderData = config.providers[baselineProviderName];

    const finalResults = { baselineCosts: {} };
    const rawData = {
        baseline: { year1: {}, year2: {} },
        system: {}
    };

    config.selectedProviders.forEach(p => {
        finalResults[p] = { annualCosts: [], cumulativeSavingsPerYear: [], npv: 0, roiYear: null };
        rawData.system[p] = { year1: {}, year2: {} };
    });
    
    const daysPerQuarter = { 'Q1_Summer': 90, 'Q2_Autumn': 91, 'Q3_Winter': 92, 'Q4_Spring': 92 };

    for (let y = 1; y <= config.numYears; y++) {
        const solarFactor = Math.pow(1 - config.solarDegradation, y - 1);
        const batteryFactor = Math.pow(1 - config.batteryDegradation, y - 1);
        const escalationFactor = Math.pow(1 + config.tariffEscalation, y - 1);

        // --- Annual Baseline Calculation ---
        let annualBaselineCost = 0;
        for (const quarter in simulationData) {
            const qData = simulationData[quarter];
            const hourlyConsumption = generateHourlyConsumptionProfileFromDailyTOU(qData.avgPeak, qData.avgShoulder, qData.avgOffPeak);
            const hourlySolar = (config.useManual ? generateHourlySolarProfileFromDaily(qData.avgSolar, quarter) : config.hourlySolarProfilePerKw.map(kwh => kwh * config.existingSolarKW)).map(s => s * solarFactor);
            
            const dailyBreakdown = simulateDay(hourlyConsumption, hourlySolar, baselineProviderData, null, escalationFactor);
            
            const importCalculator = tariffComponents[baselineProviderData.importComponent].calculate;
            const exportCalculator = tariffComponents[baselineProviderData.exportComponent].calculate;

            let dailyEnergyCost = importCalculator(baselineProviderData.importData, dailyBreakdown, 1); // No escalation inside component
            dailyEnergyCost += exportCalculator(baselineProviderData.exportData, dailyBreakdown, y, fitConfig, getDegradedFitRate, getRateForHour);
            
            const dailySupplyCharge = baselineProviderData.dailyCharge;
            annualBaselineCost += (dailySupplyCharge + dailyEnergyCost) * daysPerQuarter[quarter];
            
            if (y <= 2) {
                const yearKey = y === 1 ? 'year1' : 'year2';
                const seasonName = quarter.split('_')[1];
                rawData.baseline[yearKey][seasonName] = { days: daysPerQuarter[quarter], ...dailyBreakdown };
            }
        }
        finalResults.baselineCosts[y] = annualBaselineCost * escalationFactor;

        // --- "With System" Calculation for each selected provider ---
        config.selectedProviders.forEach(p => {
            const providerData = config.providers[p];
            const systemCostForProvider = config.initialSystemCost - (providerData.rebate || 0);
            let annualCost = (providerData.monthlyFee || 0) * 12;

            for (const quarter in simulationData) {
                const qData = simulationData[quarter];
                const baseHourlyConsumption = generateHourlyConsumptionProfileFromDailyTOU(qData.avgPeak, qData.avgShoulder, qData.avgOffPeak);
                const totalSystemKw = config.replaceExistingSystem ? config.newSolarKW : config.existingSolarKW + config.newSolarKW;
                const baseHourlySolar = (config.useManual ? generateHourlySolarProfileFromDaily((config.replaceExistingSystem ? 0 : qData.avgSolar) + (config.newSolarKW * config.manualSolarProfile), quarter) : config.hourlySolarProfilePerKw.map(kwh => kwh * totalSystemKw)).map(s => s * solarFactor);
                
                const batteryConfig = { 
                    capacity: (config.newBatteryKWH * batteryFactor), 
                    inverterKW: (config.newBatteryInverterKW * batteryFactor),
                    gridChargeThreshold: config.gridChargeThreshold
                };
                
                const dailyBreakdown = simulateDay(baseHourlyConsumption, baseHourlySolar, providerData, batteryConfig, escalationFactor);

                const importCalculator = tariffComponents[providerData.importComponent].calculate;
                const exportCalculator = tariffComponents[providerData.exportComponent].calculate;

                let dailyEnergyCost = dailyBreakdown.gridChargeCost; // Grid charge cost is pre-calculated with escalation
                dailyEnergyCost += importCalculator(providerData.importData, dailyBreakdown, 1); // Pass 1 for escalation, as it's applied to the total
                dailyEnergyCost += exportCalculator(providerData.exportData, dailyBreakdown, y, fitConfig, getDegradedFitRate, getRateForHour);
                
                const dailySupplyCharge = (providerData.dailyCharge || 0);
                annualCost += (dailySupplyCharge + dailyEnergyCost) * daysPerQuarter[quarter];
                
                if (y <= 2) {
                    const yearKey = y === 1 ? 'year1' : 'year2';
                    const seasonName = quarter.split('_')[1];
                    rawData.system[p][yearKey][seasonName] = { days: daysPerQuarter[quarter], ...dailyBreakdown };
                }
            }
            
            finalResults[p].annualCosts.push(annualCost * escalationFactor);
            const annualSavings = finalResults.baselineCosts[y] - (annualCost * escalationFactor);
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

    return {
        financials: finalResults,
        rawData: rawData,
        config: config
    };
}