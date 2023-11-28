/**********************************************************************
Version    01.00.01

Date       2023/11/14

update     --
**********************************************************************/


const fz = require('zigbee-herdsman-converters/converters/fromZigbee');
const tz = require('zigbee-herdsman-converters/converters/toZigbee');
const exposes = require('zigbee-herdsman-converters/lib/exposes');
const reporting = require('zigbee-herdsman-converters/lib/reporting');
const extend = require('zigbee-herdsman-converters/lib/extend');
const e = exposes.presets;
const ea = exposes.access;
const { Numeric } = require('zigbee-herdsman-converters/lib/exposes');
const {
    precisionRound, mapNumberRange, isLegacyEnabled, toLocalISOString, numberWithinRange, hasAlreadyProcessedMessage,
    calibrateAndPrecisionRoundOptions, addActionGroup, postfixWithEndpointName, getKey,
    batteryVoltageToPercentage,
} = require('zigbee-herdsman-converters/lib/utils');
const utils = require('zigbee-herdsman-converters/lib/utils');

let preEnergy = 0;
let preProduced_energy = 0;

const converters = {
    seMetering: {

        cluster: 'seMetering',
        type: ['attributeReport', 'readResponse'],
        options: (definition) => {
            const result = [];
            if (definition.exposes.find((e) => e.name === 'power')) {
                result.push(exposes.options.precision('power'), exposes.options.calibration('power', 'percentual'));
            }
            if (definition.exposes.find((e) => e.name === 'energy')) {
                result.push(exposes.options.precision('energy'), exposes.options.calibration('energy', 'percentual'));
            }
            if (definition.exposes.find((e) => e.name === 'produced_energy')) {
                result.push(exposes.options.precision('produced_energy'), exposes.options.calibration('energy', 'percentual'));
            }
            return result;

        },

        convert: (model, msg, publish, options, meta) => {
            if (utils.hasAlreadyProcessedMessage(msg, model)) return;
            const payload = {};
            const multiplier = msg.endpoint.getClusterAttributeValue('seMetering', 'multiplier');
            const divisor = msg.endpoint.getClusterAttributeValue('seMetering', 'divisor');
            const factor = multiplier && divisor ? multiplier / divisor : null;


            if (factor != null && (msg.data.hasOwnProperty('currentSummDelivered') ||
                msg.data.hasOwnProperty('currentSummReceived'))) {
                let energy  = preEnergy;
                let produced_energy  = preProduced_energy;
                if (msg.data.hasOwnProperty('currentSummDelivered')) {
                    const data = msg.data['currentSummDelivered'];
                    const value = (parseInt(data[0]) << 32) + parseInt(data[1]);
                    energy = value * factor;
                    preEnergy = energy;
                    // produced_energy = preProduced_energy;
                }
                if (msg.data.hasOwnProperty('currentSummReceived'))  {
                    const data = msg.data['currentSummReceived'];
                    const value = (parseInt(data[0]) << 32) + parseInt(data[1]);
                    produced_energy = value * factor;
                    preProduced_energy = produced_energy;
                    // energy = preEnergy;
                }
                payload.energy = calibrateAndPrecisionRoundOptions(energy, options, 'energy');
                payload.produced_energy = calibrateAndPrecisionRoundOptions(produced_energy, options, 'energy');
                // payload.produced_energy = produced_energy;
            }
            return payload;
        },
    },
    electrical_measurement_bituo: {
        //Bituo-SPM01
        cluster: 'haElectricalMeasurement',
        type: ['attributeReport', 'readResponse'],
        options: [
            exposes.options.precision('ac_frequency'),
            exposes.options.calibration('active_power', 'percentual'), exposes.options.precision('active_power'),
            exposes.options.calibration('current', 'percentual'), exposes.options.precision('current'),
            exposes.options.calibration('voltage', 'percentual'), exposes.options.precision('voltage'),
        ],
        convert: (model, msg, publish, options, meta) => {
            if (utils.hasAlreadyProcessedMessage(msg, model)) return;
            const getFactor = (key) => {
                const multiplier = msg.endpoint.getClusterAttributeValue('haElectricalMeasurement', `${key}Multiplier`);
                const divisor = msg.endpoint.getClusterAttributeValue('haElectricalMeasurement', `${key}Divisor`);
                const factor = multiplier && divisor ? multiplier / divisor : 1;
                return factor;
            };

            const lookup = [
                {key: 'activePower', name: 'active_power', factor: 'acPower'},
                {key: 'rmsCurrent', name: 'current', factor: 'acCurrent'},
                {key: 'rmsVoltage', name: 'voltage', factor: 'acVoltage'},
                {key: 'acFrequency', name: 'ac_frequency', factor: 'acFrequency'},
            ];

            const payload = {};
            for (const entry of lookup) {
                if (msg.data.hasOwnProperty(entry.key)) {
                    const factor = getFactor(entry.factor);
                    const property = postfixWithEndpointName(entry.name, msg, model, meta);
                    const value = msg.data[entry.key] * factor;
                    payload[property] = calibrateAndPrecisionRoundOptions(value, options, entry.name);
                }
            }

            // alarm mask
            if(msg.data.hasOwnProperty('ACAlarmsMask')){
                payload.Alarm = msg.data['ACAlarmsMask'].toString(2);
            }


            if (msg.data.hasOwnProperty('powerFactor')) {
                payload.power_factor = precisionRound(msg.data['powerFactor'] , 2);
            }
            return payload;
        },
    },
    hw_version: {
        cluster: 'genBasic',
        type: ['attributeReport', 'readResponse'],
        convert: (model, msg, publish, options, meta) => {
            const result = {};
            if (msg.data.hasOwnProperty('hwVersion')) result['hw_version'] = msg.data.hwVersion;
            return result;
        },
    },
    locationDesc: {
        cluster: 'genBasic',
        type: ['attributeReport', 'readResponse'],
        convert: (model, msg, publish, options, meta) => {
            const result = {};
            if (msg.data.hasOwnProperty('locationDesc')) result['locationDesc'] = msg.data.locationDesc;
            return result;
        },
    },
}

const power_kW = () => new Numeric('active_power', ea.STATE).withUnit('kW').withDescription('Instantaneous measured active power');
const hw_version = () => new Numeric('hw_version', ea.STATE).withUnit(' ').withDescription('Hardware Version');
const locationDesc = () => new Numeric('locationDesc', ea.STATE).withUnit(' ').withDescription('Zigbee Version');


const definition = {
    zigbeeModel: ['SPM01X001'],
    model: 'SPM01X001',
    vendor: 'BITUO TECHNIK',
    description: 'Smart energy monitor for 1P+N system',
    fromZigbee: [converters.electrical_measurement_bituo, converters.seMetering, converters.hw_version, converters.locationDesc],
    toZigbee: [],
    configure: async (device, coordinatorEndpoint, logger) => {
        const endpoint = device.getEndpoint(1);
        await reporting.bind(endpoint, coordinatorEndpoint, ['haElectricalMeasurement', 'seMetering', 'genBasic']);
        await reporting.readEletricalMeasurementMultiplierDivisors(endpoint);
        await reporting.readMeteringMultiplierDivisor(endpoint);
        await reporting.activePower(endpoint);
        await reporting.rmsCurrent(endpoint);
        await reporting.rmsVoltage(endpoint);
        await reporting.powerFactor(endpoint);
        await reporting.currentSummDelivered(endpoint);
        await reporting.currentSummReceived(endpoint);
        device.save();
    },
    exposes:  [e.ac_frequency(), e.voltage(), power_kW(), e.current(),
        e.power_factor(),
        e.energy().withDescription('Total forward active energy'),
        e.produced_energy().withDescription('Total reverse active energy'),
        hw_version(), locationDesc(),
    ],
};

module.exports = definition;
