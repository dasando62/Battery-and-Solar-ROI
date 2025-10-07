// js/analysis.js
// Version 1.1.0
import { state } from './state.js';
import { getNumericInput, escalate, parseRangesToHours, getSeason } from './utils.js';
import { tariffComponents } from './tariffComponents.js';
import { generateHourlyConsumptionProfileFromDailyTOU, generateHourlySolarProfileFromDaily } from './profiles.js';

function calculateIRR(cashFlows, guess = 0.1) {
    const maxIterations = 100;
    const tolerance = 1e-6;

    let rate = guess;

    for (let i = 0; i < maxIterations; i++) {
        let npv = 0;
        let derivative = 0;
        for (let t = 0; t < cashFlows.length; t++) {
            npv += cashFlows[t] / Math.pow(1 + rate, t);
            if (t > 0) {
                derivative -= t * cashFlows[t] / Math.pow(1 + rate, t + 1);
            }
        }
        const newRate = rate - npv / derivative;
        if (Math.abs(newRate - rate) < tolerance) {
            return newRate;
        }
        rate = newRate;
    }
    return null; // Return null if it doesn't converge
}

function calculateAverageSOCAt6am(provider, batteryConfig, simulationData) {
    if (!batteryConfig || batteryConfig.capacity === 0) {
        return 0; // Can't calculate SOC without a battery
    }
    
    let totalAnnualSocKWhDays = 0;
    const daysPerQuarter = { 'Q1_Summer': 90, 'Q2_Autumn': 91, 'Q3_Winter': 92, 'Q4_Spring': 92 };

    for (const quarter in simulationData) {
        const qData = simulationData[quarter];
        if (!qData || typeof qData.avgPeak === 'undefined') continue;

        const hourlyConsumption = generateHourlyConsumptionProfileFromDailyTOU(qData.avgPeak, qData.avgShoulder, qData.avgOffPeak);
        
        // Run a simulation for an average day in this season
        // We assume no solar to see the "worst-case" morning SOC after overnight usage.
        const simResults = simulateDay(hourlyConsumption, Array(24).fill(0), provider, batteryConfig);
        
        if (daysPerQuarter[quarter]) {
            // Add the weighted result to the annual total
            totalAnnualSocKWhDays += (simResults.socAt6am || 0) * daysPerQuarter[quarter];
        }
    }
    
    const avgSocKWh = totalAnnualSocKWhDays > 0 ? totalAnnualSocKWhDays / 365 : 0;
    // Convert the average kWh value to a percentage of the battery's capacity
    const avgSocPercent = (avgSocKWh / batteryConfig.capacity) * 100;

    return avgSocPercent;
}

function applySpecialConditions(dailyCost, dailyBreakdown, conditions, dateString) {
    let adjustedCost = dailyCost;
    if (!conditions || conditions.length === 0) {
        return adjustedCost;
    }

    // Get the current month (1-12) from the date string
    const month = parseInt(dateString.split('-')[1], 10);

    // Evaluate each condition in the order provided
    for (const condition of conditions) {
        // If the rule has a 'months' property, check if it applies today
        if (condition.months && condition.months.length > 0 && !condition.months.includes(month)) {
            continue; // Skip this rule if it's not for the current month
        }
        
        let metricValue;
        switch (condition.condition.metric) {
            case 'peak_import':
                metricValue = dailyBreakdown.peakKWh;
                break;
            case 'net_grid_usage':
                const totalImport = dailyBreakdown.peakKWh + dailyBreakdown.shoulderKWh + dailyBreakdown.offPeakKWh;
                const totalExport = dailyBreakdown.tier1ExportKWh + dailyBreakdown.tier2ExportKWh;
                metricValue = totalImport - totalExport;
                break;
            case 'import_in_window':
                const ruleHours = parseRangesToHours(condition.condition.hours || '');
                metricValue = 0;
                for (const h of ruleHours) {
                    metricValue += dailyBreakdown.hourlyImports[h] || 0;
                }
                break;
        }

        let conditionMet = false;
        switch (condition.condition.operator) {
            case 'less_than':
                conditionMet = metricValue < condition.condition.value;
                break;
            case 'less_than_or_equal_to':
                conditionMet = metricValue <= condition.condition.value;
                break;
            case 'greater_than':
                conditionMet = metricValue > condition.condition.value;
                break;
            case 'greater_than_or_equal_to':
                conditionMet = metricValue >= condition.condition.value;
                break;
        }

        if (conditionMet) {
            switch (condition.action.type) {
                case 'flat_credit':
                    adjustedCost -= condition.action.value;
                    break;
                case 'flat_charge':
                    adjustedCost += condition.action.value;
                    break;
            }
        }
    }
    return adjustedCost;
}

function getFitDegradationConfig() {
    return {
        startYear: getNumericInput("fitDegradationStartYear", 1),
        endYear: getNumericInput("fitDegradationEndYear", 10),
        minRate: getNumericInput("fitMinimumRate", 0.03)
    };
}

export function getDegradedFitRate(baseRate, year, config) {
    if (year < config.degradationStartYear) {
        return baseRate;
    }
    // If the end year is the same or before the start year, degradation is complete.
    if (year >= config.degradationEndYear || config.degradationEndYear <= config.degradationStartYear) {
        return config.minimumRate;
    }

    const totalYears = config.degradationEndYear - config.degradationStartYear;
    const currentYearIntoDegradation = year - config.degradationStartYear;
    
    // The percentage of the way through the degradation period
    const percentage = currentYearIntoDegradation / totalYears;
    
    // The total amount the rate will drop
    const rateDifference = baseRate - config.minimumRate;

    return baseRate - (rateDifference * percentage);
}

export function simulateDay(hourlyConsumption, hourlySolar, provider, batteryConfig, initialSOC = 0) {
    const results = {
        peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0,
        tier1ExportKWh: 0, tier2ExportKWh: 0,
        gridChargeKWh: 0,
        hourlyImports: Array(24).fill(0),
        hourlyExports: Array(24).fill(0)
    };
    let currentSOC = initialSOC;
    let gridChargeCost = 0;
    let socAt6am = 0;

    if (!batteryConfig) { // No-battery baseline simulation
        for (let h = 0; h < 24; h++) {
            const consumption = hourlyConsumption[h] || 0;
            const solar = hourlySolar[h] || 0;
            const net = consumption - solar;
            if (net > 0) {
                results.hourlyImports[h] = net;
            } else {
                results.hourlyExports[h] = -net;
            }
        }
    } else { // Battery simulation logic
        for (let h = 0; h < 24; h++) {
            if (h === 6) socAt6am = currentSOC;
            const consumption = hourlyConsumption[h] || 0;
            const solar = hourlySolar[h] || 0;

            const selfConsumption = Math.min(consumption, solar);
            let net = consumption - selfConsumption;
            const excessSolar = solar - selfConsumption;

            let chargeAmount = 0;
            if (excessSolar > 0 && currentSOC < batteryConfig.capacity) {
                chargeAmount = Math.min(excessSolar, batteryConfig.inverterKW, batteryConfig.capacity - currentSOC);
                currentSOC += chargeAmount;
            }
            results.hourlyExports[h] = excessSolar - chargeAmount;

            if (net > 0 && currentSOC > 0) {
                const dischargeAmount = Math.min(net, batteryConfig.inverterKW, currentSOC);
                currentSOC -= dischargeAmount;
                net -= dischargeAmount;
            }

            results.hourlyImports[h] = net;
            
            // FIX: Corrected Grid Charging Logic
            if (provider.gridChargeEnabled && h >= provider.gridChargeStart && h < provider.gridChargeEnd) {
                const chargeThresholdSOC = batteryConfig.capacity * (batteryConfig.gridChargeThreshold / 100);
                const chargeTriggerSOC = batteryConfig.capacity * (batteryConfig.socChargeTrigger / 100);

                if (currentSOC < chargeTriggerSOC) {
                    const chargeNeeded = chargeThresholdSOC - currentSOC;
                    if (chargeNeeded > 0) {
                        const gridChargeAmount = Math.min(chargeNeeded, batteryConfig.inverterKW, batteryConfig.capacity - currentSOC);
                        results.gridChargeKWh += gridChargeAmount;
                        currentSOC += gridChargeAmount;
                        results.hourlyImports[h] += gridChargeAmount;
                        
                        // Find the correct rate for the current hour using the provider's import rules
                        const touRule = (provider.importRules || []).find(r => r.type === 'tou' && parseRangesToHours(r.hours).includes(h));
                        const flatRule = (provider.importRules || []).find(r => r.type === 'flat');
                        const rateForHour = (touRule || flatRule)?.rate || 0;

                        gridChargeCost += gridChargeAmount * rateForHour;
                    }
                }
            }
        }
    }

    const peakRule = (provider.importRules || []).find(r => r.name.toLowerCase().includes('peak'));
    const shoulderRule = (provider.importRules || []).find(r => r.name.toLowerCase().includes('shoulder'));
    const peakHours = parseRangesToHours(peakRule?.hours || '');
    const shoulderHours = parseRangesToHours(shoulderRule?.hours || '');

    for (let h = 0; h < 24; h++) {
        const gridImport = results.hourlyImports[h] || 0;
        if (peakHours.includes(h)) {
            results.peakKWh += gridImport;
        } else if (shoulderHours.includes(h)) {
            results.shoulderKWh += gridImport;
        } else {
            results.offPeakKWh += gridImport;
        }
    }

    const dailyTotalExport = results.hourlyExports.reduce((a, b) => a + b, 0);
    const firstExportRule = (provider.exportRules || [])[0];
    if (provider.exportRules && firstExportRule && firstExportRule.type === 'tiered') {
        results.tier1ExportKWh = Math.min(dailyTotalExport, firstExportRule.limit || Infinity);
        results.tier2ExportKWh = dailyTotalExport - results.tier1ExportKWh;
    } else {
        results.tier1ExportKWh = dailyTotalExport;
    }

    return { dailyBreakdown: results, finalSOC: currentSOC, socAt6am: socAt6am, gridChargeCost: gridChargeCost };
}

function calculateBaseline(config, simulationData, electricityData, rawData) {
    const baselineProvider = config.providers[0];
    const importCalculator = tariffComponents.IMPORT_RULES.calculate;
    const exportCalculator = tariffComponents.EXPORT_RULES.calculate;
    const fitConfig = {
        degradationStartYear: config.fitDegradationStartYear,
        degradationEndYear: config.fitDegradationEndYear,
        minimumRate: config.fitMinimumRate,
    };

    let annualizedBaseCost = 0;
    if (config.useManual) {
        let totalCostForPeriod = 0;
        const daysInQuarter = 365 / 4;
        for (const q in simulationData) {
            const quarter = simulationData[q];
            const season = q.split('_')[1];
            const hourlyConsumption = generateHourlyConsumptionProfileFromDailyTOU(quarter.avgPeak, quarter.avgShoulder, quarter.avgOffPeak, baselineProvider.importRules);
            const degradedExistingSolar = (config.existingSolarKW * config.manualSolarProfile) * Math.pow(1 - config.solarDegradation, config.existingSystemAge);
            const hourlySolar = generateHourlySolarProfileFromDaily(degradedExistingSolar, q);
            const simResults = simulateDay(hourlyConsumption, hourlySolar, baselineProvider, null, 0);
            const dailyBreakdown = simResults.dailyBreakdown;
            const rawSeason = rawData.baseline.year1[season];
            if (rawSeason) {
                rawSeason.days += daysInQuarter;
                rawSeason.peakKWh += dailyBreakdown.peakKWh * daysInQuarter;
                rawSeason.shoulderKWh += dailyBreakdown.shoulderKWh * daysInQuarter;
                rawSeason.offPeakKWh += dailyBreakdown.offPeakKWh * daysInQuarter;
                rawSeason.tier1ExportKWh += dailyBreakdown.tier1ExportKWh * daysInQuarter;
                rawSeason.tier2ExportKWh += dailyBreakdown.tier2ExportKWh * daysInQuarter;
            }
            let dailyEnergyCost = importCalculator(baselineProvider.importRules, dailyBreakdown, { rate: 0, year: 1 });
            dailyEnergyCost -= exportCalculator(baselineProvider.exportRules, dailyBreakdown, 1, fitConfig, getDegradedFitRate);
            let totalDailyAdjustment = (baselineProvider.dailyCharge || 0) + dailyEnergyCost;
            totalCostForPeriod += totalDailyAdjustment * daysInQuarter;
        }
        annualizedBaseCost = totalCostForPeriod;
    } else if (electricityData) {
        let totalCostForPeriod = 0;
        let daysProcessed = 0;
        const peakRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('peak'));
        const shoulderRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('shoulder'));
        const peakHours = parseRangesToHours(peakRule?.hours || '');
        const shoulderHours = parseRangesToHours(shoulderRule?.hours || '');
        electricityData.forEach(day => {
            daysProcessed++;
            const dailyBreakdown = { peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0, hourlyImports: day.consumption, hourlyExports: day.feedIn };
            for (let h = 0; h < 24; h++) {
                const gridImport = day.consumption[h] || 0;
                if (peakHours.includes(h)) { dailyBreakdown.peakKWh += gridImport; }
                else if (shoulderHours.includes(h)) { dailyBreakdown.shoulderKWh += gridImport; }
                else { dailyBreakdown.offPeakKWh += gridImport; }
            }
            const season = getSeason(day.date);
            const rawSeason = rawData.baseline.year1[season];
            if (rawSeason) {
                rawSeason.days++;
                rawSeason.peakKWh += dailyBreakdown.peakKWh;
                rawSeason.shoulderKWh += dailyBreakdown.shoulderKWh;
                rawSeason.offPeakKWh += dailyBreakdown.offPeakKWh;
                const dailyTotalExport = dailyBreakdown.hourlyExports.reduce((a, b) => a + b, 0);
                const firstExportRule = (baselineProvider.exportRules || [])[0];
                if (firstExportRule && firstExportRule.type === 'tiered') {
                    const tier1Amount = Math.min(dailyTotalExport, firstExportRule.limit || Infinity);
                    rawSeason.tier1ExportKWh += tier1Amount;
                    rawSeason.tier2ExportKWh += dailyTotalExport - tier1Amount;
                } else {
                    rawSeason.tier1ExportKWh += dailyTotalExport;
                }
            }
            let dailyEnergyCost = importCalculator(baselineProvider.importRules, dailyBreakdown, { rate: 0, year: 1 });
            dailyEnergyCost -= exportCalculator(baselineProvider.exportRules, dailyBreakdown, 1, fitConfig, getDegradedFitRate);
            let totalDailyAdjustment = (baselineProvider.dailyCharge || 0) + dailyEnergyCost;
            totalDailyAdjustment = applySpecialConditions(totalDailyAdjustment, dailyBreakdown, baselineProvider.specialConditions, day.date);
            totalCostForPeriod += totalDailyAdjustment;
        });
        const annualizationFactor = daysProcessed > 0 ? 365 / daysProcessed : 0;
        annualizedBaseCost = totalCostForPeriod * annualizationFactor;
    }
    return annualizedBaseCost;
}

function calculateSystemYear(providerData, config, year, simulationData, electricityData, rawData) {
    const importCalculator = tariffComponents.IMPORT_RULES.calculate;
    const exportCalculator = tariffComponents.EXPORT_RULES.calculate;
    const fitConfig = {
        degradationStartYear: config.fitDegradationStartYear,
        degradationEndYear: config.fitDegradationEndYear,
        minimumRate: config.fitMinimumRate,
    };
    const baselineProvider = config.providers[0]; // Needed for profile generation
    let annualCost = 0;

    if (config.useManual) {
        let totalCostForPeriod = 0;
        const daysInQuarter = 365 / 4;
        for (const q in simulationData) {
            const quarter = simulationData[q];
            const season = q.split('_')[1];
            const existingSystemCurrentAge = config.existingSystemAge + year - 1;
            const newSystemCurrentAge = year - 1;
            const degradedExistingSolarDaily = (config.replaceExistingSystem ? 0 : config.existingSolarKW * config.manualSolarProfile) * Math.pow(1 - config.solarDegradation, existingSystemCurrentAge);
            const degradedNewSolarDaily = config.newSolarKW * config.manualSolarProfile * Math.pow(1 - config.solarDegradation, newSystemCurrentAge);
            const totalDegradedSolarDaily = degradedExistingSolarDaily + degradedNewSolarDaily;
            const degradedExistingBattery = (config.replaceExistingSystem ? 0 : config.existingBattery) * Math.pow(1 - config.batteryDegradation, existingSystemCurrentAge);
            const degradedNewBattery = config.newBatteryKWH * Math.pow(1 - config.batteryDegradation, newSystemCurrentAge);
            const totalDegradedBatteryCapacity = degradedExistingBattery + degradedNewBattery;
            const batteryConfig = { capacity: totalDegradedBatteryCapacity, inverterKW: config.newBatteryInverterKW, gridChargeThreshold: config.gridChargeThreshold, socChargeTrigger: config.socChargeTrigger };
            let currentSOC = batteryConfig.capacity * 0.5;
            const trueHourlyConsumption = generateHourlyConsumptionProfileFromDailyTOU(quarter.avgPeak, quarter.avgShoulder, quarter.avgOffPeak, baselineProvider.importRules);
            const totalHourlySolar = generateHourlySolarProfileFromDaily(totalDegradedSolarDaily, q);
            const simResults = simulateDay(trueHourlyConsumption, totalHourlySolar, providerData, batteryConfig, currentSOC);
            const dailyBreakdown = simResults.dailyBreakdown;
            if (year === 1) {
                const rawSeason = rawData.system[providerData.id].year1[season];
                if (rawSeason) {
                    rawSeason.days += daysInQuarter;
                    rawSeason.peakKWh += dailyBreakdown.peakKWh * daysInQuarter;
                    rawSeason.shoulderKWh += dailyBreakdown.shoulderKWh * daysInQuarter;
                    rawSeason.offPeakKWh += dailyBreakdown.offPeakKWh * daysInQuarter;
                    rawSeason.tier1ExportKWh += dailyBreakdown.tier1ExportKWh * daysInQuarter;
                    rawSeason.tier2ExportKWh += dailyBreakdown.tier2ExportKWh * daysInQuarter;
                    rawSeason.gridChargeKWh += dailyBreakdown.gridChargeKWh * daysInQuarter;
                    rawSeason.gridChargeCost += simResults.gridChargeCost * daysInQuarter;
                }
            }
            let dailyEnergyCost = simResults.gridChargeCost || 0;
            dailyEnergyCost += importCalculator(providerData.importRules, dailyBreakdown, { rate: config.tariffEscalation, year: year });
            dailyEnergyCost -= exportCalculator(providerData.exportRules, dailyBreakdown, year, fitConfig, getDegradedFitRate);
            let totalDailyAdjustment = (providerData.dailyCharge || 0) + dailyEnergyCost;
            totalCostForPeriod += totalDailyAdjustment * daysInQuarter;
        }
        annualCost = totalCostForPeriod;
    } else { // CSV Mode
        let totalCostForPeriod = 0;
        let daysProcessed = 0;
        const solarDataMap = new Map(state.solarData.map(d => [d.date, d.hourly]));
        const existingSystemCurrentAge = config.existingSystemAge + year - 1;
        const newSystemCurrentAge = year - 1;
        const degradedExistingBattery = (config.replaceExistingSystem ? 0 : config.existingBattery) * Math.pow(1 - config.batteryDegradation, existingSystemCurrentAge);
        const degradedNewBattery = config.newBatteryKWH * Math.pow(1 - config.batteryDegradation, newSystemCurrentAge);
        const totalDegradedBatteryCapacity = degradedExistingBattery + degradedNewBattery;
        let currentSOC = totalDegradedBatteryCapacity * 0.5;
        electricityData.forEach(day => {
            const existingHourlySolar_historical = solarDataMap.get(day.date);
            if (!existingHourlySolar_historical) return;
            daysProcessed++;
            const batteryConfig = { capacity: totalDegradedBatteryCapacity, inverterKW: config.newBatteryInverterKW, gridChargeThreshold: config.gridChargeThreshold, socChargeTrigger: config.socChargeTrigger };
            const degradedExistingSolar = existingHourlySolar_historical.map(s => s * Math.pow(1 - config.solarDegradation, year - 1));
            const newSolarGenerationDaily = config.newSolarKW * config.manualSolarProfile;
            const degradedNewSolarDaily = newSolarGenerationDaily * Math.pow(1 - config.solarDegradation, newSystemCurrentAge);
            const newHourlySolar = generateHourlySolarProfileFromDaily(degradedNewSolarDaily, getSeason(day.date));
            const existingSolarForSim = config.replaceExistingSystem ? Array(24).fill(0) : degradedExistingSolar;
            const totalHourlySolar = existingSolarForSim.map((s, i) => s + newHourlySolar[i]);
            const trueHourlyConsumption = Array(24).fill(0);
            for (let h = 0; h < 24; h++) {
                const selfConsumed = Math.max(0, (existingHourlySolar_historical[h] || 0) - (day.feedIn[h] || 0));
                trueHourlyConsumption[h] = (day.consumption[h] || 0) + selfConsumed;
            }
            const simResults = simulateDay(trueHourlyConsumption, totalHourlySolar, providerData, batteryConfig, currentSOC);
            currentSOC = simResults.finalSOC;
            const dailyBreakdown = simResults.dailyBreakdown;
            if (year === 1) {
                const season = getSeason(day.date);
                const rawSeason = rawData.system[providerData.id].year1[season];
                if (rawSeason) {
                    rawSeason.days++;
                    rawSeason.peakKWh += dailyBreakdown.peakKWh;
                    rawSeason.shoulderKWh += dailyBreakdown.shoulderKWh;
                    rawSeason.offPeakKWh += dailyBreakdown.offPeakKWh;
                    rawSeason.tier1ExportKWh += dailyBreakdown.tier1ExportKWh;
                    rawSeason.tier2ExportKWh += dailyBreakdown.tier2ExportKWh;
                    rawSeason.gridChargeKWh += dailyBreakdown.gridChargeKWh;
                    rawSeason.gridChargeCost += simResults.gridChargeCost;
                }
            }
            let dailyEnergyCost = simResults.gridChargeCost || 0;
            dailyEnergyCost += importCalculator(providerData.importRules, dailyBreakdown, { rate: config.tariffEscalation, year: year });
            dailyEnergyCost -= exportCalculator(providerData.exportRules, dailyBreakdown, year, fitConfig, getDegradedFitRate);
            let totalDailyAdjustment = (providerData.dailyCharge || 0) + dailyEnergyCost;
            totalDailyAdjustment = applySpecialConditions(totalDailyAdjustment, dailyBreakdown, providerData.specialConditions, day.date);
            totalCostForPeriod += totalDailyAdjustment;
        });
        const annualizationFactor = daysProcessed > 0 ? 365 / daysProcessed : 0;
        annualCost = totalCostForPeriod * annualizationFactor;
    }
    return annualCost;
}

export function runSimulation(config, simulationData, electricityData) {
    const finalResults = { baselineCosts: [] };
    const rawData = { baseline: { year1: {} }, system: {} };

    config.selectedProviders.forEach(pId => {
        const provider = config.providers.find(p => p.id === pId);
        if (!provider) return;
        finalResults[provider.id] = { annualCosts: [], cumulativeSavingsPerYear: [], roiYear: null, npv: 0 };
        rawData.system[provider.id] = { year1: {} };
        for (const q of ['Summer', 'Autumn', 'Winter', 'Spring']) {
            rawData.baseline.year1[q] = { days: 0, peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0, tier1ExportKWh: 0, tier2ExportKWh: 0, gridChargeKWh: 0, gridChargeCost: 0 };
            rawData.system[provider.id].year1[q] = { days: 0, peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0, tier1ExportKWh: 0, tier2ExportKWh: 0, gridChargeKWh: 0, gridChargeCost: 0 };
        }
    });

    const annualizedBaseCost = calculateBaseline(config, simulationData, electricityData, rawData);

    for (let y = 1; y <= config.numYears; y++) {
        finalResults.baselineCosts[y] = escalate(annualizedBaseCost, config.tariffEscalation, y);

        config.selectedProviders.forEach(p => {
            const providerData = config.providers.find(prov => prov.id === p);
            if (!providerData) return;

            const annualCost = calculateSystemYear(providerData, config, y, simulationData, electricityData, rawData);

            const finalAnnualCost = annualCost + escalate((providerData.monthlyFee || 0) * 12, config.tariffEscalation, y);
            finalResults[p].annualCosts.push(finalAnnualCost);

            const annualSavings = finalResults.baselineCosts[y] - finalAnnualCost;
            const prevSavings = y > 1 ? finalResults[p].cumulativeSavingsPerYear[y - 2] : 0;
            const cumulativeSavings = prevSavings + annualSavings - (y <= config.loanTerm ? config.annualLoanRepayment : 0);
            
            if (cumulativeSavings > (config.initialSystemCost - (providerData.rebate || 0)) && !finalResults[p].roiYear) {
                finalResults[p].roiYear = y;
            }
            finalResults[p].cumulativeSavingsPerYear.push(cumulativeSavings);
            if (config.discountRateEnabled) {
                finalResults[p].npv += annualSavings / Math.pow(1 + config.discountRate, y);
            }
        });
    }
	config.selectedProviders.forEach(p => {
    const providerData = config.providers.find(prov => prov.id === p);
    if (!providerData) return;

    // Create the cash flow array: [-investment, savings_yr1, savings_yr2, ...]
    const initialInvestment = config.initialSystemCost - (providerData.rebate || 0);
    const annualSavings = [];
    for (let y = 1; y <= config.numYears; y++) {
        const systemCostForYear = finalResults[p].annualCosts[y - 1];
        const baselineCostForYear = finalResults.baselineCosts[y];
        annualSavings.push(baselineCostForYear - systemCostForYear);
    }

    const cashFlows = [-initialInvestment, ...annualSavings];

    // Only calculate IRR if there are positive savings
    if (annualSavings.some(s => s > 0)) {
        const irr = calculateIRR(cashFlows);
        finalResults[p].irr = irr !== null ? irr * 100 : null; // Store as a percentage
    } else {
        finalResults[p].irr = null;
    }
});

    return { financials: finalResults, rawData: rawData, config: config };
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
            if (daysInQ) {
                totalKWh += (q.avgPeak + q.avgShoulder + q.avgOffPeak) * daysInQ;
                // --- FIX: Improved heuristic for "evening" consumption ---
                // We now take all of peak, but only half of off-peak as a better guess for
                // consumption during non-solar hours (evening + overnight).
                totalEveningKWh += (q.avgPeak + (q.avgOffPeak * 0.5)) * daysInQ;
                totalDays += daysInQ;
            }
        }
    }
    
    let avgDailyGenerationPerKW = 4.0; 
    const existingKW = getNumericInput('existingSolarKW');
    if (state.solarData && state.solarData.length > 0 && existingKW > 0) {
        const totalGeneration = state.solarData.reduce((acc, day) => acc + day.hourly.reduce((a, b) => a + b, 0), 0);
        const avgDailyGeneration = totalGeneration / state.solarData.length;
        avgDailyGenerationPerKW = avgDailyGeneration / existingKW;
    }
    
    const avgDailyConsumption = totalDays > 0 ? totalKWh / totalDays : 0;
    const totalAnnualKWh = avgDailyConsumption * 365;
    const avgDailyEveningConsumption = totalDays > 0 ? totalEveningKWh / totalDays : 0;
    const targetAnnualGeneration = totalAnnualKWh * (coverageTarget / 100);
    let recommendedSolarKW = (avgDailyGenerationPerKW > 0) ? targetAnnualGeneration / (avgDailyGenerationPerKW * 365) : 0;
    recommendedSolarKW = Math.round(recommendedSolarKW * 2) / 2;
    
    // The rest of the logic is fine
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

export function calculateDetailedSizing(correctedElectricityData, solarData, config, simulationData) {
    if (!correctedElectricityData) return null;

    const baselineProvider = config.providers.find(p => p.id === config.selectedProviders[0]);
    let peakHours = [];
    if (baselineProvider) {
        const peakRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('peak'));
        peakHours = parseRangesToHours(peakRule?.hours || '');
    }

    const totalSolarKW = config.replaceExistingSystem ? config.newSolarKW : config.existingSolarKW + config.newSolarKW;
    const solarProfileSourceKw = config.existingSolarKW > 0 ? config.existingSolarKW : 1;
    const solarDataMap = config.noExistingSolar ? new Map() : new Map((solarData || []).map(day => [day.date, day.hourly]));
    
    const dailyPeakPeriodData = [];
    const dailyMaxHourData = [];
    let totalDays = 0;

    correctedElectricityData.forEach(day => {
        totalDays++;
        let dailyPeakPeriodKWh = 0;
        let dailyMaxHourKWh = 0;
        
        let hourlySolar;
        if (config.noExistingSolar) {
            const totalDailySolar = totalSolarKW * config.manualSolarProfile;
            const month = parseInt(day.date.split('-')[1], 10);
            const season = [12,1,2].includes(month) ? 'Q1_Summer' : [3,4,5].includes(month) ? 'Q2_Autumn' : [6,7,8].includes(month) ? 'Q3_Winter' : 'Q4_Spring';
            hourlySolar = generateHourlySolarProfileFromDaily(totalDailySolar, season);
        } else {
            const hourlySolarRaw = solarDataMap.get(day.date) || Array(24).fill(0);
            hourlySolar = hourlySolarRaw.map(h => (h / solarProfileSourceKw) * totalSolarKW);
        }

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
    const finalInverterRec = (Math.ceil(recommendedInverterKW * 2) / 2);
    const batteryCoverageDays = dailyPeakPeriodData.filter(d => d <= finalBatteryRec).length;
    const inverterCoverageDays = dailyMaxHourData.filter(d => d <= finalInverterRec).length;
    
    const heuristicRecs = calculateSizingRecommendations(config.recommendationCoverageTarget, simulationData);

    let blackoutResults = null;
    if (config.blackoutSizingEnabled && config.blackoutDuration > 0 && config.blackoutCoverage > 0) {
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
        blackoutResults = { requiredReserve, totalCalculatedSize, practicalSize };
    }

    return {
        heuristic: heuristicRecs,
        detailed: {
            recommendedBatteryKWh: finalBatteryRec,
            recommendedInverterKW: finalInverterRec,
            batteryCoverageDays: batteryCoverageDays,
            inverterCoverageDays: inverterCoverageDays,
            totalDays: totalDays,
        },
        distributions: {
            peakPeriod: dailyPeakPeriodData,
            maxHourly: dailyMaxHourData,
        },
        blackout: blackoutResults
    };
}