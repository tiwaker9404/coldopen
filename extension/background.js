// Opens coldopen with a job post (or company website) ready to make into a film. Nothing is
// read from the page or sent anywhere but the link itself, and only when you click.
const APP = 'https://coldopen-nk8o.onrender.com/'

function open(url) {
  if (!/^https?:\/\//.test(url ?? '')) return
  chrome.tabs.create({ url: `${APP}?make=${encodeURIComponent(url)}` })
}

chrome.action.onClicked.addListener((tab) => open(tab.url))

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'coldopen-link',
    title: 'Make a coldopen film for this link',
    contexts: ['link'],
  })
  chrome.contextMenus.create({
    id: 'coldopen-page',
    title: 'Make a coldopen film for this page',
    contexts: ['page'],
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) =>
  open(info.menuItemId === 'coldopen-link' ? info.linkUrl : tab?.url),
)

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'make') open(msg.url ?? sender.tab?.url)
})
