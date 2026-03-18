// @ts-nocheck
import {Route as rootRoute} from './routes/__root'
import {Route as accountRoute} from './routes/account'
import {Route as artifactBrowserRoute} from './routes/app.artifacts.$owner.$repo.$aliasType.$identifier.$artifactName'
import {Route as billingRoute} from './routes/billing'
import {Route as dashboardRoute} from './routes/dashboard'
import {Route as indexRoute} from './routes/index'
import {Route as loginRoute} from './routes/login'
import {Route as settingsRoute} from './routes/settings'

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  accountRoute,
  billingRoute,
  settingsRoute,
  dashboardRoute,
  artifactBrowserRoute,
])
