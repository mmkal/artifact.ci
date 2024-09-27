import * as cheerio from 'cheerio'

/** GitHub doesn't provide an API for getting sponsors of a given username but it's pretty easy to "scrape" w/ HTML */
export const getGithubSponsors = async (params: {sponsoree: string}) => {
  const sponsors: {id: string; type: 'user' | 'org'}[] = []
  for (let page = 1; page <= 100; page++) {
    const url = `https://github.com/sponsors/${params.sponsoree}/sponsors_partial?filter=active&page=${page}`
    const res = await fetch(url)
    const html = await res.text()
    const $ = cheerio.load(html)
    const usernames = $('[data-hovercard-type="user"]')
      .toArray()
      .flatMap(el => {
        const attr = $(el).attr('data-hovercard-url')
        return attr?.match(/^\/users\/(.*)\/hovercard$/)?.[1] || []
      })

    const organizations = $('[data-hovercard-type="organization"]')
      .toArray()
      .flatMap(el => {
        const attr = $(el).attr('data-hovercard-url')
        return attr?.match(/^\/orgs\/(.*)\/hovercard$/)?.[1] || []
      })

    if (usernames.length === 0 && organizations.length === 0) break
    sponsors.push(
      ...usernames.map(id => ({id, type: 'user'}) as const),
      ...organizations.map(id => ({id, type: 'org'}) as const),
    )

    if (page === 100) {
      const message = `Reached page limit of 100 for ${params.sponsoree} (over ${sponsors.length} sponsors) - congratulations! Now move on to a better payment model.`
      throw new Error(message)
    }
  }
  return sponsors
}
