import {expect, test} from '@playwright/test'
import {TagLogger} from '../src/tag-logger'

const createLogger = () => {
  const argses: any[][] = []
  const mocks = {
    info: (...args: any[]) => argses.push(['info', ...args]),
    warn: (...args: any[]) => argses.push(['warn', ...args]),
    error: (...args: any[]) => argses.push(['error', ...args]),
    debug: (...args: any[]) => argses.push(['debug', ...args]),
  }
  return {
    mocks,
    argses,
    logger: new TagLogger(mocks),
  }
}

test('logger', () => {
  const {logger, argses} = createLogger()
  const one = () => {
    logger.info('one')
  }
  logger.run('numero=uno', one)

  expect(argses).toEqual([['info', '[numero=uno]', 'one']])
})

test('stores memories', () => {
  const {logger, argses} = createLogger()
  const one = (input: number) => {
    logger.debug('dbg-one', {input})
    logger.run('depth=prettydeep', () => {
      logger.debug('dbg-two', {depth: 1})
      logger.run('depth=deeper', () => {
        if (input > 0.5) {
          logger.warn('pretty big input')
        }
      })
    })
  }
  logger.run('numero=uno', () => one(0.1))

  expect(argses).toEqual([]) // no logs, because there was no warning, so no need to recall logger.debug(...) calls

  logger.run('numero=dos', () => one(0.9))

  expect(argses).toEqual([
    [
      'warn',
      '[numero=dos][depth=prettydeep][depth=deeper]',
      'pretty big input',
      'memories:',
      [expect.stringMatching(/^2.*/), 'debug', '[numero=dos]', 'dbg-one', {input: 0.9}],
      [expect.stringMatching(/^2.*/), 'debug', '[numero=dos][depth=prettydeep]', 'dbg-two', {depth: 1}],
    ],
  ])
})
