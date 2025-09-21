// js/analysis.js
import { tariffComponents } from './tariffComponents.js';
import { generateHourlyConsumptionProfileFromDailyTOU, generateHourlySolarProfileFromDaily } from './profiles.js';
import { getNumericInput } from './utils.js';

function getRateForHour(hour, rates) {
    for (const rateInfo of rates) {
        if (rateInfo.hours.length > 0 && rateInfo.hours.includes(hour)) { return rateInfo.rate; }
    }
    const otherRule = rates.find(r => r.hours.length === 0);
    return otherRule ? otherRule.rate : 0;
}
function getFitDegradationConfig() {
    return { startYear: getNumericInput("fitDegradationStartYear", 1), endYear: getNumericInput("fitDegradationEndYear", 10), minRate: getNumericInput("fitMinimumRate", -0.03) };
}
export function getDegradedFitRate(baseRate, year, fitConfig) {
    if (typeof baseRate !== 'number') return 0;
    const { startYear, endYear, minRate } = fitConfig;
    if (year < startYear) return baseRate;
    if (year >= endYear) return minRate;
    const progress = (year - startYear) / (endYear - startYear);
    return baseRate - (progress * (baseRate - minRate));
}
export function simulateDay(hourlyConsumption, hourlySolar, provider, batteryConfig = null, escalationFactor = 1) {
    let batterySOC = 0;
    const results = { peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0, tier1ExportKWh: 0, tier2ExportKWh: 0, gridChargeKWh: 0, gridChargeCost: 0, hourlyExports: Array(24).fill(0) };
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
        for (let h = 0; h < 24; h++) {
            const net = hourlyConsumption[h] - hourlySolar[h];
            if (net > 0) {
                finalHourlyConsumption[h] = net;
            } else {
                finalHourlyConsumption[h] = 0;
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
    const fitConfig = getFitDegradationConfig();
    const baselineProviderName = config.selectedProviders[0];
    const baselineProviderData = config.providers[baselineProviderName];

    const finalResults = { baselineCosts: {} };
    const rawData = { baseline: { year1: {}, year2: {} }, system: {} };

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
            const dailyBreakdown = simulateDay(hourlyConsumption, hourlySolar, baselineProviderData, null, 1);
            
            const importCalculator = tariffComponents[baselineProviderData.importComponent].calculate;
            const exportCalculator = tariffComponents[baselineProviderData.exportComponent].calculate;

            let dailyEnergyCost = importCalculator(baselineProviderData.importData, dailyBreakdown, 1);
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

                let dailyEnergyCost = dailyBreakdown.gridChargeCost; 
                dailyEnergyCost += importCalculator(providerData.importData, dailyBreakdown, 1);
                dailyEnergyCost += exportCalculator(providerData.exportData, dailyBreakdown, y, fitConfig, getDegradedFitRate, getRateForHour);
                
                const dailySupplyCharge = (providerData.dailyCharge || 0);
                annualCost += (dailySupplyCharge + dailyEnergyCost) * daysPerQuarter[quarter];
                
                if (y <= 2) {
                    const yearKey = y === 1 ? 'year1' : 'year2';
                    const seasonName = quarter.split('_')[1];
                    rawData.system[p][yearKey][seasonName] = { days: daysPerQuarter[quarter], ...dailyBreakdown };
                }
            }
            
            const finalAnnualCost = annualCost * escalationFactor;
            
            finalResults[p].annualCosts.push(finalAnnualCost);
            const annualSavings = finalResults.baselineCosts[y] - finalAnnualCost;
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

export function calculateSizingRecommendations(coverageTarget, simulationData) {
    if (!simulationData || Object.keys(simulationData).length < 4) {
        return null;
    }

    const daysPerQuarter = { 'Q1_Summer': 90, 'Q2_Autumn': 91, 'Q3_Winter': 92, 'Q4_Spring': 92 };

    let totalAnnualKWh = 0;
    let totalEveningKWh = 0;
    for (const quarter in simulationData) {
        const q = simulationData[quarter];
        const dailyTotal = q.avgPeak + q.avgShoulder + q.avgOffPeak;
        const dailyEvening = q.avgPeak + q.avgOffPeak;
        totalAnnualKWh += dailyTotal * daysPerQuarter[quarter];
        totalEveningKWh += dailyEvening * daysPerQuarter[quarter];
    }

    const avgDailyGenerationPerKW = 4.0;
    const targetAnnualGeneration = totalAnnualKWh * (coverageTarget / 100);
    let recommendedSolarKW = targetAnnualGeneration / (avgDailyGenerationPerKW * 365);
    recommendedSolarKW = Math.round(recommendedSolarKW * 2) / 2;

    const avgDailyEveningConsumption = totalEveningKWh / 365;

    const scalingFactor = coverageTarget / 90;
    const targetEveningConsumption = avgDailyEveningConsumption * scalingFactor;

    let recommendedBatteryKWh;
    if (targetEveningConsumption <= 5) recommendedBatteryKWh = 5;
    else if (targetEveningConsumption <= 10) recommendedBatteryKWh = 10;
    else if (targetEveningConsumption <= 13.5) recommendedBatteryKWh = 13.5;
    else if (targetEveningConsumption <= 16) recommendedBatteryKWh = 16;
    else if (targetEveningConsumption <= 20) recommendedBatteryKWh = 20;
    else if (targetEveningConsumption <= 24) recommendedBatteryKWh = 24;
    else if (targetEveningConsumption <= 32) recommendedBatteryKWh = 32;
    else if (targetEveningConsumption <= 40) recommendedBatteryKWh = 40;
    else if (targetEveningConsumption <= 48) recommendedBatteryKWh = 48;
    else recommendedBatteryKWh = Math.round(targetEveningConsumption);

    let recommendedInverterKW;
    if (recommendedSolarKW <= 6.6) recommendedInverterKW = 5;
    else if (recommendedSolarKW <= 10) recommendedInverterKW = 8;
    else recommendedInverterKW = 10;

    return {
        solar: recommendedSolarKW,
        battery: recommendedBatteryKWh,
        inverter: recommendedInverterKW
    };
}