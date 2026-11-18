# Playwright's image has Chromium and its system libraries at the version the
# lockfile pins (@playwright/test 1.65.1). Selenium's Chrome and chromedriver
# are fetched by Selenium Manager at build time, so a Selenium run never
# waits on a download.
FROM mcr.microsoft.com/playwright:v1.65.1-noble

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    SE_CACHE_PATH=/app/.selenium \
    CHROME_ARGS="--no-sandbox --disable-dev-shm-usage --disable-gpu --renderer-process-limit=2"

COPY package.json package-lock.json ./
# Dev dependencies too: selenium-webdriver and tsx run the "Run the generated tests" option.
RUN npm ci --include=dev --ignore-scripts

COPY . .
RUN fetch='const f=require("selenium-webdriver/common/driverFinder.js");const c=require("selenium-webdriver/chrome.js");console.log(f.getBinaryPaths(new c.Options()))' \
 && (node -e "$fetch" || (sleep 10 && node -e "$fetch")) \
 && chown -R pwuser:pwuser /app

USER pwuser
EXPOSE 10000
CMD ["node", "bin/autogen.js", "serve"]
