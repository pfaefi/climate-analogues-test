// Optional survey before and after the game (app_plan.md §10 point 5, §10a).
// Switched off in settings.js until data protection and research ethics are clarified with
// WSL. While it is off, both functions return at once without asking anything, so the game
// works the same with and without the survey. When it is switched on, the questions, the
// consent line and the answer scale will be added here.

export async function surveyBeforeGame(place) {
  if (!window.APP_SETTINGS.survey.enabled) return null;
  return null;      // to be built: ask the question, send the answer with sendEvent()
}

export async function surveyAfterGame(place) {
  if (!window.APP_SETTINGS.survey.enabled) return null;
  return null;      // to be built
}
