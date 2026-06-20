/**
 * @typedef {Object} ApiError
 * @property {string} code
 * @property {string} message
 */

/**
 * @typedef {Object} AiRouteRequest
 * @property {{text:string}} input
 */

/**
 * @typedef {Object} AiRouteResult
 * @property {"switch_view"|"show_weather"|"show_cameras"|"show_calendar"|"status_explain"|"unknown"} intent
 * @property {"home"|"weather"|"cameras"|"timeline"|"status"|"briefing"} [view]
 * @property {number} confidence
 * @property {string} response
 */

/**
 * @typedef {Object} HaSnapshotNormalized
 * @property {{id:string,label:string}|null} home_mode
 * @property {{id:string,severity:"info"|"warning"|"critical",title:string,age_s:number}[]} alerts
 * @property {{id:string,label:string,state:"ok"|"warning"|"down",detail:string}[]} connectivity
 * @property {{id:string,label:string,state:"ok"|"warning"|"down",detail:string}[]} devices
 */

/**
 * @typedef {Object} WeatherNowNormalized
 * @property {{name:string,tz:string}} location
 * @property {{temp_c:number|null,feels_like_c:number|null,condition:{code:number|null,label:string|null,icon:string|null},wind_kph:number|null,humidity_pct:number|null,uv:number|null,rain_chance_pct:number|null}} now
 * @property {{high_c:number|null,low_c:number|null,sunrise:string|null,sunset:string|null}} day
 */

/**
 * @typedef {Object} WeatherForecastNormalized
 * @property {{date:string,high_c:number|null,low_c:number|null,condition:{code:number|null,label:string|null,icon:string|null},rain_chance_pct:number|null}[]} days
 */

export {};
