import cisco from './cisco_ios.js';
import procurve from './hp_procurve.js';
import comware from './hp_comware.js';
import generic from './generic.js';

const all = [cisco, procurve, comware, generic];
export const drivers = Object.fromEntries(all.map((d) => [d.id, d]));
export const driverList = all.map((d) => ({
  id: d.id,
  label: d.label,
  capabilities: Object.keys(d.read).concat(Object.keys(d.write)),
}));
export const getDriver = (id) => drivers[id] || generic;
