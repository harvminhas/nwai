/**
 * External Data Layer — public API.
 *
 * Import from here. Do not import from sub-modules directly.
 */

export { runExternalDataPipeline } from "./pipeline";
export { getExternalData, getAllExternalData, setExternalData } from "./store";
export { EXTERNAL_DATA_REGISTRY, detectCountry } from "./registry";
export type { ExternalDataPoint, ExternalDataType, ExternalSignal, Country } from "./types";
