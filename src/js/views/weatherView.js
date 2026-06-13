import { startWeather, stopWeatherView } from "../services/weather/renderer.js";

export function createWeatherView() {
  return {
    render: () => {},
    onEnter: () => {
      startWeather();
    },
    onLeave: () => {
      stopWeatherView();
    }
  };
}
