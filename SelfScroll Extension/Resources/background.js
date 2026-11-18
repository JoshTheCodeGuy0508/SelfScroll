// Background service worker for SelfScroll
const api = typeof browser !== 'undefined' ? browser : chrome;

// Listen for extension installation or update
api.runtime.onInstalled.addListener(() => {
    console.log('SelfScroll extension installed and ready.');
});
