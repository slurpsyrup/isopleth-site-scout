// Cookie-less Umami analytics, the same loader isopleth.dev uses. Counts only on scout.isopleth.dev, honours Do Not Track,
// skips the repeat page views that moving the map would cause,
// and strips every query parameter except utm_* (so the ?at= point is never sent) plus the #fragment.
// Forks: delete this file and its <script> tag in index.html, or put in your own website ID and domain.
(function(){try{var K=["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
function c(u,keep){if(!u)return u;try{var x=new URL(u,location.href),q=new URLSearchParams();if(keep)K.forEach(function(k){var v=x.searchParams.get(k);if(v)q.set(k,v.slice(0,100))});x.search=q.toString();x.hash="";return /^https?:/i.test(u)?x.toString():x.pathname+x.search}catch(e){return ""}}
var last;window.umamiBeforeSend=function(t,p){if(p){p.url=c(p.url,1);p.referrer=c(p.referrer,0);if(!p.name){if(p.url===last)return false;last=p.url}}return p};
var s=document.createElement("script"),a={"website-id": "254dcc09-8189-4a88-a5eb-1730404eb21c", "domains": "scout.isopleth.dev", "exclude-hash": "true", "do-not-track": "true", "before-send": "umamiBeforeSend"};s.defer=true;s.src="https://stats.isopleth.dev/script.js";
for(var k in a)s.setAttribute("data-"+k,a[k]);document.head.appendChild(s)}catch(e){}})();
