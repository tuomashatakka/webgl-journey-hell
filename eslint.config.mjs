import shared from '@tuomashatakka/eslint-config'


/**
 * Effects live in src/hooks by design (AGENTS.md, "State"): each one is a
 * custom hook in a module of its own — exactly where prefer-no-use-effect
 * sends them. Flagging them there as well would only flag the remedy.
 */
const hooks = {
  files: [ 'src/hooks/**/*.ts' ],
  rules: { 'react-strict/prefer-no-use-effect': 'off' },
}

/**
 * Journey content — integrators, set dressing, mesh and audio-graph builders
 * under src/journeys — reads top to bottom as one authored sequence, and
 * splitting it into helpers to satisfy a branch count scatters the piece of
 * the world it describes. Everything shared (packages, hooks, components,
 * tools) keeps the house limits.
 */
const journeyContent = {
  files: [ 'src/journeys/**/*.ts' ],
  rules: {
    'complexity':     'off',
    'max-statements': 'off',
  },
}

export default [ ...shared, hooks, journeyContent ]
