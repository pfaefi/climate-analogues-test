// Question box below the world map of the results (app_plan.md §24b): two click questions
// after a played game, one after the other («1/2», «2/2»), announced as two from the start.
// Switched on in settings.js (survey.enabled). Each click is sent at once with sendEvent(), so
// an answer to question 1 counts even without question 2. Asked once per device: after an
// answer to question 1 the box does not appear in later games (memory.js).
// Test mode: while no events are stored (settings.js events.endpoint null, the public test
// site for now), the box says so and appears after every game, so that testers can try it
// and are still asked once the answers are stored.

import { t } from "./i18n.js";
import { sendEvent } from "./events.js";
import { surveyAnswered, rememberSurveyAnswered } from "./memory.js";

// Question 1: change compared with before the game, from -2 (viel harmloser) to +2 (viel
// schlimmer). Question 2: overall impression of the images, 1 to 4 (no middle, §24b).
const QUESTION_1 = [
  { value: -2, key: "survey_q1_much_less" },
  { value: -1, key: "survey_q1_less" },
  { value: 0, key: "survey_q1_same" },
  { value: 1, key: "survey_q1_worse" },
  { value: 2, key: "survey_q1_much_worse" }
];
const QUESTION_2 = [
  { value: 1, key: "survey_q2_not" },
  { value: 2, key: "survey_q2_rather_not" },
  { value: 3, key: "survey_q2_rather" },
  { value: 4, key: "survey_q2_very" }
];

let seenObserver = null;      // reports once per game that the box came into view

// True while the answers go nowhere (no endpoint for the events).
function testMode() {
  return window.APP_SETTINGS.events.endpoint === null;
}

// Show the box for a finished game (game is null when the game was skipped: no box).
export function showSurveyBox(place, game) {
  const box = document.getElementById("survey-box");
  if (seenObserver !== null) seenObserver.disconnect();
  box.hidden = true;
  if (!window.APP_SETTINGS.survey.enabled || game === null) return;
  if (!testMode() && surveyAnswered()) return;

  // The order of the answers of question 1 is reversed at random for half of the games
  // (people on phones more often pick the first answer; §24b).
  game.survey = { reversed: Math.random() < 0.5 };
  document.getElementById("survey-test").hidden = !testMode();
  box.hidden = false;
  askQuestion1(place, game);

  // For the response rate: did the box come into view at all (it lies below the map)?
  seenObserver = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    sendEvent("survey_seen", { bundle: place.cell.bundle, games_on_device: game.gamesOnDevice });
    seenObserver.disconnect();
  }, { threshold: 0.5 });
  seenObserver.observe(box);
}

function askQuestion1(place, game) {
  const answers = game.survey.reversed ? QUESTION_1.slice().reverse() : QUESTION_1;
  showQuestion(1, t("survey_q1", { place: place.phrase }), answers, value => {
    sendAnswer(place, game, 1, value);
    if (!testMode()) rememberSurveyAnswered();
    askQuestion2(place, game);
  });
}

function askQuestion2(place, game) {
  showQuestion(2, t("survey_q2"), QUESTION_2, value => {
    sendAnswer(place, game, 2, value);
    showThanks();
  });
}

// Fill the box with one question and its answer buttons; onAnswer(value) runs on a click.
function showQuestion(step, question, answers, onAnswer) {
  document.getElementById("survey-step").textContent = t("survey_step", { step: step });
  document.getElementById("survey-question").textContent = question;
  const list = document.getElementById("survey-answers");
  list.replaceChildren();
  list.hidden = false;
  for (const answer of answers) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "survey-answer";
    button.textContent = t(answer.key);
    button.addEventListener("click", () => onAnswer(answer.value), { once: true });
    list.append(button);
  }
}

function showThanks() {
  document.getElementById("survey-step").textContent = "";
  document.getElementById("survey-question").textContent = t("survey_thanks");
  document.getElementById("survey-answers").hidden = true;
}

// One answer with what the player saw: the five images (panorama and region), the points,
// whether «Resultate im Detail» was opened before, and the number of games on this device.
// Nothing about the person (§24a).
function sendAnswer(place, game, question, value) {
  const geoPoints = game.results.reduce((sum, r) => sum + r.points, 0);
  const climatePoints = game.results.reduce((sum, r) => sum + r.climate.points, 0);
  sendEvent("survey_answer", {
    bundle: place.cell.bundle,
    question: question,
    answer: value,
    reversed: question === 1 ? game.survey.reversed : null,
    pano_ids: game.results.map(r => r.pano.pano_id),
    region_ids: game.results.map(r => r.pano.region_id),
    points: geoPoints,
    climate_points: climatePoints,
    detail_before: game.detailShown === true,
    games_on_device: game.gamesOnDevice
  });
}
