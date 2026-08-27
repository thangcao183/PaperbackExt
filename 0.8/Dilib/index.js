const types = require('@paperback/types');

const DOMAIN = 'https://dilib.vn/';

const DilibInfo = {
  version: '0.1.0',
  name: 'Dilib',
  icon: 'icon.png',
  author: 'thangcao183',
  authorWebsite: 'https://github.com/thangcao183/PaperbackExt',
  description: 'Extension that pulls Vietnamese manga from Dilib.vn',
  contentRating: types.ContentRating.EVERYONE,
  websiteBaseURL: DOMAIN,
  sourceTags: [{ text: 'Vietnamese', type: types.BadgeColor.BLUE }],
  intents: types.SourceIntents.MANGA_CHAPTERS | types.SourceIntents.HOMEPAGE_SECTIONS,
};

class Dilib {
  constructor(cheerio) {
    this.cheerio = cheerio;
    this.requestManager = App.createRequestManager({
      requestsPerSecond: 3,
      requestTimeout: 50000,
      interceptor: {
        interceptRequest: async (request) => {
          request.headers = {
            ...(request.headers || {}),
            referer: DOMAIN,
            'user-agent': await this.requestManager.getDefaultUserAgent(),
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'accept-language': 'vi-VN,vi;q=0.9,en;q=0.8',
          };
          return request;
        },
        interceptResponse: async (response) => response,
      },
    });
  }

  async DOMHTML(url) {
    const response = await this.requestManager.schedule(App.createRequest({ url, method: 'GET' }), 1);
    if (response.status >= 400) throw new Error(`Dilib HTTP ${response.status}`);
    return this.cheerio.load(response.data || '');
  }

  getMangaShareUrl(mangaId) {
    return `${DOMAIN}${mangaId}`;
  }

  async getMangaDetails(mangaId) {
    const $ = await this.DOMHTML(`${DOMAIN}${mangaId}`);
    const title = $('h1').first().text().trim() || $('title').first().text().split('|')[0].trim();
    const author = $('p').filter((_, el) => $(el).find('b').first().text().trim().startsWith('Tác giả')).find('a').first().text().trim();
    const description = $('.description, .summary, .detail-content, .story-detail-info, .content').first().text().trim();
    const image = this.image($('img').filter((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      return !src.includes('/logo') && !src.includes('avatar') && ($(el).attr('alt') || src.includes('/img/news/'));
    }).first());
    const tags = $('a[href*="the-loai"], a[href*="genre"], a[href*="category"]').map((_, el) => ({ id: $(el).text().trim(), label: $(el).text().trim() })).get().filter((tag, i, all) => tag.label && all.findIndex((x) => x.id === tag.id) === i);
    const body = $('body').text().toLowerCase();
    return App.createSourceManga({
      id: mangaId,
      mangaInfo: App.createMangaInfo({
        image,
        artist: author,
        author,
        desc: description,
        status: body.includes('hoàn thành') ? 'Completed' : 'Ongoing',
        hentai: false,
        titles: [title],
        tags: [App.createTagSection({ id: 'genres', label: 'Thể loại', tags: tags.map((tag) => App.createTag(tag)) })],
      }),
    });
  }

  async getChapters(mangaId) {
    const $ = await this.DOMHTML(`${DOMAIN}${mangaId}`);
    return $('a[href*="-chap-"]').map((_, el) => {
      const href = $(el).attr('href') || '';
      const id = href.replace(DOMAIN, '').replace(/^\//, '').split('?')[0];
      const name = $(el).text().trim() || `Chap ${(id.match(/-chap-([\d.]+)/i) || [])[1] || ''}`;
      const number = Number.parseFloat((name.match(/(?:chap(?:ter)?|chương)\s*[-:]?\s*([\d.]+)/i) || name.match(/([\d.]+)/) || [0, 0])[1]);
      return App.createChapter({ id, chapNum: number, name, group: 'Dilib', time: new Date(0), langCode: 'vi' });
    }).get();
  }

  async getChapterDetails(mangaId, chapterId) {
    const $ = await this.DOMHTML(`${DOMAIN}${chapterId}`);
    const pages = $('img').map((_, el) => this.image($(el))).get().filter((url, i, all) => url.includes('/img/comic/') && all.indexOf(url) === i);
    return App.createChapterDetails({ id: chapterId, mangaId, pages });
  }

  async getSearchResults(query, metadata) {
    const page = metadata?.page || 1;
    const keyword = query.title ? `?keyword=${encodeURIComponent(query.title)}&page=${page}` : '';
    const $ = await this.DOMHTML(`${DOMAIN}${keyword}`);
    const results = $('a').filter((_, el) => {
      const href = $(el).attr('href') || '';
      return /\/[^/]+-\d+\.html$/.test(href) && !href.includes('-chap-') && $(el).closest('.block_product_thumbnail').length;
    }).map((_, el) => {
      const image = this.image($(el).find('img').first());
      return App.createPartialSourceManga({ mangaId: ($(el).attr('href') || '').replace(/^\//, ''), title: $(el).attr('title') || $(el).find('img').attr('alt') || $(el).text().trim(), image });
    }).get();
    return App.createPagedResults({ results, metadata: results.length ? { page: page + 1 } : undefined });
  }

  async getHomePageSections(sectionCallback) {
    const section = App.createHomeSection({ id: 'latest', title: 'Mới cập nhật', containsMoreItems: false, type: types.HomeSectionType.singleRowNormal });
    sectionCallback(section);
    const $ = await this.DOMHTML(`${DOMAIN}truyen-tranh/`);
    section.items = $('a').filter((_, el) => {
      const href = $(el).attr('href') || '';
      return /\/[^/]+-\d+\.html$/.test(href) && $(el).closest('.block_product_thumbnail').length;
    }).map((_, el) => App.createPartialSourceManga({ mangaId: ($(el).attr('href') || '').replace(/^\//, ''), title: $(el).attr('title') || $(el).find('img').attr('alt') || $(el).text().trim(), image: this.image($(el).find('img').first()) })).get();
  }

  image(img) {
    const src = img.attr('data-src') || img.attr('data-original') || img.attr('data-lazy-src') || img.attr('src') || '';
    return src.startsWith('http') ? src : `${DOMAIN}${src.replace(/^\//, '')}`;
  }
}

module.exports = { Dilib, DilibInfo };
