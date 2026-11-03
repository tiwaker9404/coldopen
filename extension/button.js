// A "Make film" button on job posts. It shows only on a single post (not a list of jobs) and
// sends nothing until it's clicked.
;(() => {
  const isPost = () => {
    const { host, pathname, search } = location
    if (host.endsWith('linkedin.com'))
      return /\/jobs\/view\/\d+/.test(pathname) || /currentJobId=\d+/.test(search)
    if (host === 'www.ycombinator.com') return /\/companies\/[^/]+\/jobs\/[^/]+/.test(pathname)
    if (host === 'wellfound.com') return /\/jobs\/\d+/.test(pathname)
    // Greenhouse, Lever, Ashby, Workable: a post has an id after the company
    return pathname.split('/').filter(Boolean).length >= 2
  }
  const postUrl = () => {
    // LinkedIn's search page keeps the post in the query; send the post's own link
    const id = new URLSearchParams(location.search).get('currentJobId')
    return id && location.host.endsWith('linkedin.com')
      ? `https://www.linkedin.com/jobs/view/${id}/`
      : location.href
  }
  const ID = 'coldopen-make'
  const sync = () => {
    const there = document.getElementById(ID)
    if (!isPost()) return there?.remove()
    if (there) return
    const b = document.createElement('button')
    b.id = ID
    b.type = 'button'
    b.textContent = 'Make film'
    b.title = 'Open coldopen with this job post, ready to make a 30-second film'
    b.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'make', url: postUrl() }))
    document.body.appendChild(b)
  }
  sync()
  // single-page sites (LinkedIn) change the post without reloading
  let last = location.href
  setInterval(() => {
    if (location.href !== last) {
      last = location.href
      sync()
    }
  }, 800)
})()
