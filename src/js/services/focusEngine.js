const SEVERE_WEATHER_PATTERN = /storm|severe|warning|heavy rain|flood/i;

export function computeFocus({
  bomWarning,
  weatherCondition,
  weatherTemp,
  commuteActive,
  commuteText,
  nextEventActive,
  nextEventText
} = {}) {
  if (bomWarning) {
    return { icon: "⚠️", text: bomWarning };
  }

  if (weatherCondition && SEVERE_WEATHER_PATTERN.test(weatherCondition)) {
    return {
      icon: "⚠️",
      text: weatherTemp ? `${weatherCondition} · ${weatherTemp}` : weatherCondition
    };
  }

  if (commuteActive && commuteText) {
    return { icon: "🚗", text: commuteText };
  }

  if (nextEventActive && nextEventText) {
    return { icon: "📅", text: nextEventText };
  }

  return null;
}
