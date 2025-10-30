// js/constants.js
// Version 1.3.5
// This file holds constants that are used in multiple files.

/*
 * Home Battery & Solar ROI Analyser
 * Copyright (c) 2025 [DaSando62]
 *
 * This software is licensed under the MIT License.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// js/constants.js
// Version 1.2.2
// Central repository for application-wide constants to prevent magic strings and improve maintainability.

export const SEASONS = {
    SUMMER: 'Q1_Summer',
    AUTUMN: 'Q2_Autumn',
    WINTER: 'Q3_Winter',
    SPRING: 'Q4_Spring'
};

export const TARIFF_RULE_TYPES = {
    TIME_OF_USE: 'tou',
    TIERED: 'tiered',
    FLAT: 'flat',
    CONTROLLED_LOAD: 'controlled_load'
};

export const SPECIAL_CONDITIONS = {
    METRIC: {
        PEAK_IMPORT: 'peak_import',
        NET_GRID_USAGE: 'net_grid_usage',
        IMPORT_IN_WINDOW: 'import_in_window'
    },
    OPERATOR: {
        LESS_THAN_OR_EQUAL: 'less_than_or_equal_to',
        LESS_THAN: 'less_than',
        GREATER_THAN: 'greater_than',
        GREATER_THAN_OR_EQUAL: 'greater_than_or_equal_to'
    },
    ACTION: {
        FLAT_CREDIT: 'flat_credit',
        FLAT_CHARGE: 'flat_charge'
    }
};

export const NEM12_SUFFIX = {
    GRID_IMPORT: 'E1',
    GRID_EXPORT: 'B1'
};

export const LOCAL_STORAGE_KEYS = {
    PROVIDERS: 'roiAnalyser_providers',
    DEFAULTS_LOADED: 'roiAnalyser_defaults_loaded'
};

export const DEFAULT_TOU_HOURS = {
    PEAK: '3pm-11pm',
    SHOULDER: '7am-3pm'
};