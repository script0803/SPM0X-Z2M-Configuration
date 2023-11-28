/**********************************************************************
Version    01.00.02

Date       2023/10/26

update     支持读取总有功功率，三相无功功率，总无功功率，
           三相势在功率，总势在功率，系统频率
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
        //bituo-SPM02
        cluster: 'haElectricalMeasurement',
        type: ['attributeReport', 'readResponse'],
        options: [
            exposes.options.precision('ac_frequency'), exposes.options.precision('total_active_power'),
            exposes.options.calibration('active_power', 'percentual'), exposes.options.precision('active_power'),
            exposes.options.precision('active_power_phase_b'), exposes.options.precision('active_power_phase_c'),
            exposes.options.precision('total_power_apparent'), exposes.options.precision('power_apparent'),
            exposes.options.precision('power_apparent_phase_b'), exposes.options.precision('power_apparent_phase_c'),
            exposes.options.precision('total_power_reactive'), exposes.options.precision('power_reactive'),
            exposes.options.precision('power_reactive_phase_b'), exposes.options.precision('power_reactive_phase_c'),
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
                {key: 'activePowerPhB', name: 'active_power_phase_b', factor: 'acPower'},
                {key: 'activePowerPhC', name: 'active_power_phase_c', factor: 'acPower'},
                {key: 'totalActivePower', name: 'total_active_power', factor: 'acPower'},
                {key: 'apparentPower', name: 'power_apparent', factor: 'acPower'},
                {key: 'apparentPowerPhB', name: 'power_apparent_phase_b', factor: 'acPower'},
                {key: 'apparentPowerPhC', name: 'power_apparent_phase_c', factor: 'acPower'},
                {key: 'totalAppaarentPower', name: 'total_power_apparent', factor: 'acPower'},
                {key: 'reactivePower', name: 'power_reactive', factor: 'acPower'},
                {key: 'reactivePowerPhB', name: 'power_reactive_phase_b', factor: 'acPower'},
                {key: 'reactivePowerPhC', name: 'power_reactive_phase_c', factor: 'acPower'},
                {key: 'totalReactivePower', name: 'total_power_reactive', factor: 'acPower'},
                {key: 'rmsCurrent', name: 'current', factor: 'acCurrent'},
                {key: 'rmsCurrentPhB', name: 'current_phase_b', factor: 'acCurrent'},
                {key: 'rmsCurrentPhC', name: 'current_phase_c', factor: 'acCurrent'},
                {key: 'rmsVoltage', name: 'voltage', factor: 'acVoltage'},
                {key: 'rmsVoltagePhB', name: 'voltage_phase_b', factor: 'acVoltage'},
                {key: 'rmsVoltagePhC', name: 'voltage_phase_c', factor: 'acVoltage'},
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
            if (msg.data.hasOwnProperty('powerFactorPhB')) {
                payload.power_factor_phase_b = precisionRound(msg.data['powerFactorPhB'] , 2);
            }
            if (msg.data.hasOwnProperty('powerFactorPhC')) {
                payload.power_factor_phase_c = precisionRound(msg.data['powerFactorPhC'] , 2);
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
    const power_kW_phase_b = () => new Numeric('active_power_phase_b', ea.STATE).withUnit('kW').withDescription('Instantaneous measured active power on phase B');
    const power_kW_phase_c = () => new Numeric('active_power_phase_c', ea.STATE).withUnit('kW').withDescription('Instantaneous measured active power on phase C');
    const total_power_kW = () => new Numeric('total_active_power', ea.STATE).withUnit('kW').withDescription('Instantaneous measured total active power');
    const power_factor_phase_b = () => new Numeric('power_factor_phase_b', ea.STATE).withUnit('%').withDescription('Instantaneous measured power factor on phase B');
    const power_factor_phase_c = () => new Numeric('power_factor_phase_c', ea.STATE).withUnit('%').withDescription('Instantaneous measured power factor on phase C');
    const power_reactive = () => new Numeric('power_reactive', ea.STATE).withUnit('kVAR').withDescription('Instantaneous measured reactive power');
    const power_reactive_phase_b = () => new Numeric('power_reactive_phase_b', ea.STATE).withUnit('kVAR').withDescription('Instantaneous measured reactive power on phase B');
    const power_reactive_phase_c = () => new Numeric('power_reactive_phase_c', ea.STATE).withUnit('kVAR').withDescription('Instantaneous measured reactive power on phase C');
    const total_power_reactive = () => new Numeric('total_power_reactive', ea.STATE).withUnit('kVAR').withDescription('Instantaneous measured total reactive power');
    const power_apparent = () => new Numeric('power_apparent', ea.STATE).withUnit('kVA').withDescription('Instantaneous measured apparent power');
    const power_apparent_phase_b = () => new Numeric('power_apparent_phase_b', ea.STATE).withUnit('kVA').withDescription('Instantaneous measured apparent power on phase B');
    const power_apparent_phase_c = () => new Numeric('power_apparent_phase_c', ea.STATE).withUnit('kVA').withDescription('Instantaneous measured apparent power on phase C');
    const total_power_apparent = () => new Numeric('total_power_apparent', ea.STATE).withUnit('kVA').withDescription('Instantaneous measured total apparent power');
    const hw_version = () => new Numeric('hw_version', ea.STATE).withUnit(' ').withDescription('Hardware Version');
    const locationDesc = () => new Numeric('locationDesc', ea.STATE).withUnit(' ').withDescription('Zigbee Version');


const definition = {
    zigbeeModel: ['SPM02X001'],// The model ID from: Device with modelID 'lumi.sens' is not supported.
    model: 'SPM02X001', // Vendor model number, look on the device for a model number
    vendor: 'BITUO TECHNIK', // Vendor of the device (only used for documentation and startup logging)
    description: 'Smart energy monitor for 3P+N system',
    fromZigbee: [converters.electrical_measurement_bituo, converters.seMetering, converters.hw_version, converters.locationDesc],
    toZigbee: [],
    //configure: tuya.configureMagicPacket,
    configure: async (device, coordinatorEndpoint, logger) => {
        const endpoint = device.getEndpoint(1);// 选取1为服务端点，spm0x只有1
        await reporting.bind(endpoint, coordinatorEndpoint, ['haElectricalMeasurement', 'seMetering', 'genBasic']);// 将端点1与haElectricalMeasurement绑定
        await reporting.readEletricalMeasurementMultiplierDivisors(endpoint);// 读取电力测量的乘法因子和除法因子
        await reporting.readMeteringMultiplierDivisor(endpoint);
        await reporting.activePower(endpoint);// 有功功率
        await reporting.rmsCurrent(endpoint);// 电流
        await reporting.rmsVoltage(endpoint);// 电压
        await reporting.powerFactor(endpoint);
        await reporting.apparentPower(endpoint);
        await reporting.reactivePower(endpoint);
        await reporting.currentSummDelivered(endpoint);
        await reporting.currentSummReceived(endpoint);
        device.save();
    },
    exposes:  [e.ac_frequency(), e.voltage(), e.voltage_phase_b(), e.voltage_phase_c(),
        power_kW(), power_kW_phase_b(), power_kW_phase_c(), total_power_kW(),
        e.current(), e.current_phase_b(), e.current_phase_c(),
        e.power_factor(), power_factor_phase_b(), power_factor_phase_c(),
        power_reactive(), power_reactive_phase_b(), power_reactive_phase_c(), total_power_reactive(),
        power_apparent(), power_apparent_phase_b(), power_apparent_phase_c(), total_power_apparent(),
        // Change the description according to the specifications of the device
        e.energy().withDescription('Total forward active energy'),
        e.produced_energy().withDescription('Total reverse active energy'),
        hw_version(), locationDesc(),
        //e.paySwitch().withDescription('预付费开关'),
    ],
};

module.exports = definition;
