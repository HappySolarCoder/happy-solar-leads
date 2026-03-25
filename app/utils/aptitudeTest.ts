export type LikertValue = 1 | 2 | 3 | 4 | 5;
export type SjtValue = 'A' | 'B' | 'C' | 'D';

export type AptitudeSectionKey = 'grit' | 'drive' | 'coachability' | 'judgment' | 'background';

export type AptitudeQuestion = {
  id: string;
  section: AptitudeSectionKey;
  prompt: string;
  type: 'likert' | 'single';
  options?: { value: string; label: string; score?: number }[];
  bestAnswer?: string;
};

export const likertOptions = [
  { value: '1', label: 'Strongly Disagree' },
  { value: '2', label: 'Disagree' },
  { value: '3', label: 'Neutral' },
  { value: '4', label: 'Agree' },
  { value: '5', label: 'Strongly Agree' },
];

export const aptitudeQuestions: AptitudeQuestion[] = [
  ...[
    'I can stay focused and productive even when the work is repetitive.',
    'I usually keep going after most people would quit.',
    'I am comfortable working long days if the opportunity is worth it.',
    'I do not need someone checking on me constantly to stay productive.',
    'Rejection motivates me more than it discourages me.',
    'I recover quickly after a bad day.',
    'I would rather be judged by my results than by how busy I look.',
    'I naturally push myself harder when there is a clear goal to hit.',
  ].map((prompt, index) => ({ id: `q${index + 1}`, section: 'grit' as const, prompt, type: 'likert' as const, options: likertOptions })),
  ...[
    'I enjoy competition and want to win.',
    'I like performance-based environments where the top people stand out.',
    'I am motivated by scoreboards, rankings, or clear metrics.',
    'If someone on my team is outperforming me, I want to raise my level.',
    'I would rather have a role with upside than one that feels safe but capped.',
    'I enjoy chasing targets that feel difficult but achievable.',
  ].map((prompt, index) => ({ id: `q${index + 9}`, section: 'drive' as const, prompt, type: 'likert' as const, options: likertOptions })),
  ...[
    'I take feedback well even when it is blunt.',
    'If a top performer tells me to change my approach, I will test it quickly.',
    'I like being part of a team that pushes each other to improve.',
    'I am willing to practice a script or process until I get it right.',
    'I can stay professional even when I disagree with a coach or manager.',
  ].map((prompt, index) => ({ id: `q${index + 15}`, section: 'coachability' as const, prompt, type: 'likert' as const, options: likertOptions })),
  {
    id: 'q20', section: 'judgment', type: 'single', prompt: 'You have been knocking for two hours with no wins and your energy is slipping. What do you do?', bestAnswer: 'B', options: [
      { value: 'A', label: 'Head home early and reset tomorrow' },
      { value: 'B', label: 'Take a short reset, review your approach, and keep knocking with urgency' },
      { value: 'C', label: 'Slow down and only knock houses that look easiest' },
      { value: 'D', label: 'Wait for your manager to tell you what to do' },
    ]
  },
  { id: 'q21', section: 'judgment', type: 'single', prompt: 'A homeowner says, "Not interested," and starts to close the door. What is your best response?', bestAnswer: 'C', options: [
      { value: 'A', label: 'Thank them and walk away immediately every time' },
      { value: 'B', label: 'Push harder and keep talking over them' },
      { value: 'C', label: 'Calmly try one short, respectful follow-up before disengaging' },
      { value: 'D', label: 'Joke with them until they change their mind' },
  ]},
  { id: 'q22', section: 'judgment', type: 'single', prompt: 'Your teammate is getting more appointments than you this week. What is the best response?', bestAnswer: 'B', options: [
      { value: 'A', label: 'Assume they just got lucky' },
      { value: 'B', label: 'Ask what they are doing differently and apply it fast' },
      { value: 'C', label: 'Avoid comparing yourself so you do not get discouraged' },
      { value: 'D', label: 'Focus only on staying positive' },
  ]},
  { id: 'q23', section: 'judgment', type: 'single', prompt: 'A prospect says they are interested but busy and asks you to come back later. What is the best move?', bestAnswer: 'B', options: [
      { value: 'A', label: 'Leave and hope they remember you' },
      { value: 'B', label: 'Try to lock in a specific follow-up time and note it' },
      { value: 'C', label: 'Keep talking until they give you a firm answer' },
      { value: 'D', label: 'Mark it as a dead lead' },
  ]},
  { id: 'q24', section: 'judgment', type: 'single', prompt: 'A manager tells you that your pitch is too long and your tone is too soft. What is the best response?', bestAnswer: 'C', options: [
      { value: 'A', label: 'Defend your style because it feels natural' },
      { value: 'B', label: 'Ignore it unless you hear it twice' },
      { value: 'C', label: 'Shorten the pitch immediately and test the feedback that day' },
      { value: 'D', label: 'Ask to switch territories instead' },
  ]},
  { id: 'q25', section: 'judgment', type: 'single', prompt: 'It is hot, you are tired, and you still have an hour left in the shift. What is the best decision?', bestAnswer: 'C', options: [
      { value: 'A', label: 'End early because one hour will not matter much' },
      { value: 'B', label: 'Knock selectively and save energy' },
      { value: 'C', label: 'Finish the hour strong because the last hour still counts' },
      { value: 'D', label: 'Sit in the car and make phone calls' },
  ]},
  { id: 'q26', section: 'background', type: 'single', prompt: 'Which background best describes you?', options: [
    { value: 'competitive-sports', label: 'Competitive sports', score: 10 },
    { value: 'military', label: 'Military', score: 10 },
    { value: 'sales', label: 'Sales/customer-facing work', score: 8 },
    { value: 'physical-work', label: 'Physically demanding job', score: 7 },
    { value: 'none', label: 'None of the above', score: 3 },
  ]},
  { id: 'q27', section: 'background', type: 'single', prompt: 'In the last few years, where have you most clearly shown discipline?', options: [
    { value: 'sports-training', label: 'Sports training', score: 10 },
    { value: 'work-performance', label: 'Work performance', score: 9 },
    { value: 'school', label: 'School/academics', score: 7 },
    { value: 'fitness', label: 'Fitness/health', score: 8 },
    { value: 'family', label: 'Family responsibility', score: 7 },
    { value: 'not-disciplined', label: 'I have not been very disciplined lately', score: 2 },
  ]},
  { id: 'q28', section: 'background', type: 'single', prompt: 'Which statement sounds most like you?', options: [
    { value: 'comfort', label: 'I like comfort and predictability more than pressure', score: 2 },
    { value: 'handle-pressure', label: 'I can handle pressure, but I do not seek it out', score: 5 },
    { value: 'perform-under-pressure', label: 'I tend to perform better when there is pressure and something to win', score: 10 },
    { value: 'self-driven', label: 'I need very little pressure to stay driven', score: 8 },
  ]},
];

export const sectionLabels: Record<AptitudeSectionKey, string> = {
  grit: 'Work Ethic & Grit',
  drive: 'Competitiveness & Drive',
  coachability: 'Coachability & Team Orientation',
  judgment: 'Door-to-Door Situational Judgment',
  background: 'Experience / Athletics / Hustle Indicators',
};

export const sectionWeights: Record<AptitudeSectionKey, number> = {
  grit: 30,
  drive: 20,
  coachability: 20,
  judgment: 20,
  background: 10,
};

export type AptitudeAnswers = Record<string, string>;

export function scoreAptitudeTest(answers: AptitudeAnswers) {
  const sectionRaw: Record<AptitudeSectionKey, number> = { grit: 0, drive: 0, coachability: 0, judgment: 0, background: 0 };
  const sectionMaxRaw: Record<AptitudeSectionKey, number> = { grit: 0, drive: 0, coachability: 0, judgment: 0, background: 0 };

  aptitudeQuestions.forEach((question) => {
    const answer = answers[question.id];
    if (!answer) return;

    if (question.type === 'likert') {
      const value = Number(answer);
      sectionRaw[question.section] += value;
      sectionMaxRaw[question.section] += 5;
      return;
    }

    if (question.section === 'judgment') {
      sectionRaw.judgment += answer === question.bestAnswer ? 1 : 0;
      sectionMaxRaw.judgment += 1;
      return;
    }

    const option = question.options?.find((opt) => opt.value === answer);
    sectionRaw.background += option?.score || 0;
    sectionMaxRaw.background += 10;
  });

  const sectionScores = Object.fromEntries(
    (Object.keys(sectionWeights) as AptitudeSectionKey[]).map((section) => {
      const max = sectionMaxRaw[section] || 1;
      const weighted = Math.round((sectionRaw[section] / max) * sectionWeights[section]);
      return [section, weighted];
    })
  ) as Record<AptitudeSectionKey, number>;

  const totalScore = Object.values(sectionScores).reduce((sum, value) => sum + value, 0);
  const recommendation = totalScore >= 85 ? 'Strong Interview' : totalScore >= 70 ? 'Interview' : totalScore >= 55 ? 'Maybe' : 'Low Priority';

  const greenFlags: string[] = [];
  const redFlags: string[] = [];
  if (sectionScores.grit >= 24) greenFlags.push('High grit / work ethic');
  if (sectionScores.coachability >= 16) greenFlags.push('High coachability');
  if (sectionScores.drive >= 16) greenFlags.push('Highly competitive / driven');
  if (sectionScores.judgment >= 16) greenFlags.push('Strong situational judgment');
  if (['competitive-sports', 'military', 'sales'].includes(answers.q26 || '')) greenFlags.push('Strong prior performance background');

  if ((Number(answers.q5 || 0)) <= 2) redFlags.push('Low resilience to rejection');
  if ((Number(answers.q15 || 0)) <= 2) redFlags.push('Low willingness to take feedback');
  if ((Number(answers.q4 || 0)) <= 2) redFlags.push('Low ownership / self-direction');
  if ((Number(answers.q9 || 0)) <= 2 || (Number(answers.q10 || 0)) <= 2) redFlags.push('Low competitiveness');
  const weakSjt = ['q20','q21','q22','q23','q24','q25'].filter((id) => answers[id] && answers[id] !== aptitudeQuestions.find((q) => q.id === id)?.bestAnswer).length;
  if (weakSjt >= 3) redFlags.push('Multiple weak situational judgment answers');

  return { sectionScores, totalScore, recommendation, greenFlags, redFlags };
}
