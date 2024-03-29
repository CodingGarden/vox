/* eslint-disable no-confusing-arrow */
/* eslint-disable camelcase */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-restricted-globals */
/* eslint-disable no-prototype-builtins */
/* eslint-disable no-return-assign */
/* eslint-disable no-param-reassign */
/* eslint-disable no-new */

import DOMPurify from './lib/purify.min.js';
import marked from './lib/marked.min.js';
import Vue from './lib/vue.min.js';
import io from './lib/socket.io.js';
import * as timeago from './lib/timeago.min.js';
import feathers from './lib/feathers.js';

const topic = document.querySelector('#topic');
const info = document.querySelector('#info');
const loading = document.querySelector('.loading');
const main = document.querySelector('main');

topic.addEventListener('click', () => {
  if (info.style.display === 'none') {
    info.style.display = '';
  } else {
    info.style.display = 'none';
  }
});

(async () => {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.hasAttribute('src')) {
      node.setAttribute('src', `https://external-content.duckduckgo.com/iu/?u=${node.getAttribute('src')}`);
    }
  });

  const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:2020' : 'https://api.coding.garden';
  // const API_URL = 'https://api.coding.garden';

  function sanitize(message) {
    message.sanitized = DOMPurify
      .sanitize(marked(message.content), {
        FORBID_ATTR: [
          'class',
          'style',
          'onerror',
          'onload',
          'onanimationend',
        ],
        FORBID_TAGS: [
          'table',
          'script',
          'audio',
          'video',
          'style',
          'iframe',
          'object',
          'embed',
          'textarea',
          'frame',
          'frameset',
        ],
      });
  }

  function setTimesent(message) {
    message.timesent = timeago.format(message.created_at);
  }

  function processMessage(message, user) {
    setTimesent(message);
    sanitize(message);
    if (message.author_handle) {
      message.platform = 'youtube';
    }
    if (!message.badges) {
      message.badges = {
        moderator: user ? user.is_chat_moderator : false,
      };
    }
    message.showSource = false;
    message.isPotentiallyNaughty = message.message.match(/<|>/i);
  }

  const client = feathers();
  client.configure(feathers.socketio(io(API_URL, {
    timeout: 15000,
    'connect timeout': 5000,
    upgrade: false,
    transports: ['websocket'],
  })));
  const voxPopuliService = client.service('vox/populi');
  const twitchUsersService = client.service('twitch/users');
  const youtubeUsersService = client.service('youtube/users');
  let scrollTimeOut;

  const isLast5Minutes = (date) => date ? (new Date(date) > Date.now() - (60 * 5 * 1000)) : false;

  const isHere = (last_seen, created_at) => isLast5Minutes(last_seen) || isLast5Minutes(created_at);

  new Vue({
    el: '#messages',
    data: {
      broadcasterId: '413856795',
      showInfo: true,
      firstLoad: true,
      isAdmin: localStorage.token,
      selectedTab: 'questions',
      all: {
        questions: [],
        submissions: [],
        ideas: [],
      },
      today: [],
      usersByUsername: {},
      authors: {},
    },
    async created() {
      document.querySelector('.chat').style.display = '';
      this.loadMessages();
    },
    computed: {
      todayQuestions() {
        const today = new Date().toDateString();
        return this.all.questions.filter((q) => new Date(q.created_at).toDateString() === today);
      },
      pinned() {
        return [
          ...this.all.questions.filter((item) => item.pinned),
          ...this.all.submissions.filter((item) => item.pinned),
          ...this.all.ideas.filter((item) => item.pinned),
        ];
      },
      allByNum() {
        const byNum = {};
        this.all.questions.forEach((item) => byNum[item.num] = item);
        this.all.submissions.forEach((item) => byNum[item.num] = item);
        this.all.ideas.forEach((item) => byNum[item.num] = item);
        return byNum;
      },
      sortedItems() {
        let items = [];
        if (this.selectedTab === 'today') {
          items = this.todayQuestions;
        } if (this.selectedTab === 'questions') {
          items = this.all.questions;
        } else if (this.selectedTab === 'ideas') {
          items = this.all.ideas;
        } else if (this.selectedTab === 'submissions') {
          items = this.all.submissions;
        }

        const sorted = items.sort((a, b) => {
          if (a.is_here && !b.is_here) return -1;
          if (b.is_here && !a.is_here) return 1;
          if ((a.user.subscription || a.user.membership) && !(b.user.subscription || b.user.membership)) return -1;
          if (!(a.user.subscription || a.user.membership) && (b.user.subscription || b.user.membership)) return 1;
          if (a.badges.moderator && !b.badges.moderator) return -1;
          if (b.badges.moderator && !a.badges.moderator) return 1;
          if (a.badges.vip && !b.badges.vip) return -1;
          if (b.badges.vip && !a.badges.vip) return 1;
          const diff = b.upvotes.length - a.upvotes.length;
          if (diff !== 0) return diff;
          return new Date(a.created_at) - new Date(b.created_at);
        });
        return sorted;
      },
    },
    methods: {
      scrollIntoView() {
        if (!this.firstLoad) return;
        clearTimeout(scrollTimeOut);
        // debounce until last item has been added to page
        scrollTimeOut = setTimeout(() => {
          // force browser to scroll to item after all items have loaded
          if (window.location.hash) {
            window.location.href = window.location.href;
          }
          this.firstLoad = true;
        }, 100);
      },
      onRemoved(message) {
        const args = message.message.split(' ');
        const command = args.shift();
        if (command.match(/^!(ask|idea|submit)/)) {
          if (!message.num) return;
          if (command === '!ask') {
            const index = this.all.questions.findIndex((item) => item.id === message.id);
            if (index !== -1) {
              this.all.questions.splice(index, 1);
            }
          } else if (command === '!idea') {
            const index = this.all.ideas.findIndex((item) => item.id === message.id);
            if (index !== -1) {
              this.all.ideas.splice(index, 1);
            }
          } else if (command === '!submit') {
            const index = this.all.submissions.findIndex((item) => item.id === message.id);
            if (index !== -1) {
              this.all.submissions.splice(index, 1);
            }
          }
        } else if (command.match(/^!(comment)/)) {
          const num = (args.shift() || '').replace('#', '');
          if (!num || isNaN(num) || !this.allByNum[num]) return;
          if (command === '!comment') {
            const index = this.allByNum[num].comments.findIndex((item) => item.id === message.id);
            if (index !== -1) {
              this.allByNum[num].comments.splice(index, 1);
            }
          }
        }
      },
      async pin(message) {
        console.log('Pinning message...', message);
        await voxPopuliService.patch(message._id, {
          pinned: true,
        }, {
          query: {
            key: localStorage.token,
          },
        });
      },
      async archive(message) {
        await voxPopuliService.remove(message._id, {
          query: {
            key: localStorage.token,
          },
        });
      },
      async loadMessages() {
        const all = await voxPopuliService.find();
        voxPopuliService.on('created', (message) => {
          this.addLatestMessage(message);
        });
        voxPopuliService.on('patched', (message) => {
          this.updateMessage(message);
        });
        voxPopuliService.on('removed', (message) => {
          this.onRemoved(message);
        });
        twitchUsersService.on('patched', (user) => {
          const updateUser = (message) => {
            if (message.username === user.name) {
              message.user = user;
            }
            if (message.comments) {
              message.comments.forEach(updateUser);
            }
          };
          all.questions.forEach(updateUser);
          all.ideas.forEach(updateUser);
          all.submissions.forEach(updateUser);
        });
        youtubeUsersService.on('patched', (user) => {
          const updateUser = (message) => {
            if (message.author_handle === user.handle) {
              message.user = user;
            }
            if (message.comments) {
              message.comments.forEach(updateUser);
            }
          };
          all.questions.forEach(updateUser);
          all.ideas.forEach(updateUser);
          all.submissions.forEach(updateUser);
        });
        const usersByUsername = all.users.reduce((byName, user) => {
          byName[user.handle || user.name] = user;
          return byName;
        }, {});
        const notFoundUser = {
          _id: 'not-found',
          name: 'No Found',
          created_at: '2018-03-03T01:26:07.36562Z',
          logo: 'https://i.imgur.com/jidTZrw.png',
          follow: false,
          subscription: false,
        };
        const processMessages = (type) => (message) => {
          const user = usersByUsername[message.author_handle || message.username] || notFoundUser;
          processMessage(message, user);
          message.user = user;
          message.type = type;
          message.upvotes = [...new Set(message.upvotes)];
          message.is_here = isHere(message.user.last_seen, message.created_at);
          message.comments.forEach((comment) => {
            comment.user = usersByUsername[comment.author_handle || comment.username] || notFoundUser;
            processMessage(comment);
          });
        };
        all.questions.forEach(processMessages('questions'));
        all.ideas.forEach(processMessages('ideas'));
        all.submissions.forEach(processMessages('submissions'));
        this.usersByUsername = usersByUsername;
        this.all = all;
        if (window.location.hash) {
          const num = window.location.hash.split('-')[1];
          if (this.allByNum.hasOwnProperty(num)) {
            const message = this.allByNum[num];
            this.selectedTab = message.type;
          }
        }
        setInterval(() => {
          const setTimeSents = (message) => {
            setTimesent(message);
            message.is_here = isHere(message.user.last_seen, message.created_at);
            message.comments.forEach((comment) => {
              setTimesent(comment);
              comment.is_here = isHere(comment.user.last_seen, message.created_at);
            });
          };
          all.questions.forEach(setTimeSents);
          all.ideas.forEach(setTimeSents);
          all.submissions.forEach(setTimeSents);
        }, 2000);
        loading.style.opacity = 0;
        main.style.opacity = 1;
      },
      updateMessage(message) {
        if (this.allByNum[message.num]) {
          let found = this.all.questions.find((item) => item.num === message.num);
          if (!found) {
            found = this.all.submissions.find((item) => item.num === message.num);
          }

          if (!found) {
            found = this.all.ideas.find((item) => item.num === message.num);
          }

          if (found) {
            this.$set(found, 'pinned', true);
          }
        }
      },
      addLatestMessage(message) {
        this.$set(this.usersByUsername, message.author_handle || message.username, message.user);
        message.is_here = true;
        const args = (message.parsedMessage || message.message).split(' ');
        const command = args.shift();
        if (command.match(/^!(ask|idea|submit)/)) {
          if (!message.num) return;
          if (this.allByNum[message.num]) return;
          const value = args.join(' ');
          message.content = value;
          message.comments = [];
          message.upvotes = [];
          message.upvote_count = 0;
          if (command === '!ask') {
            message.type = 'questions';
            this.all.questions.push(message);
          } else if (command === '!idea') {
            message.type = 'ideas';
            this.all.ideas.push(message);
          } else if (command === '!submit') {
            message.type = 'submissions';
            this.all.submissions.push(message);
          }
          processMessage(message, message.user);
        } else if (command.match(/^!(comment|upvote)/)) {
          const num = (args.shift() || '').replace('#', '');
          if (!num || isNaN(num) || !this.allByNum[num]) return;
          if (command === '!comment') {
            message.content = args.join(' ');
            processMessage(message, message.user);
            this.allByNum[num].comments.push(message);
          } else if (command === '!upvote') {
            this.allByNum[num].upvotes.push(message.author_handle || message.username);
            this.allByNum[num].upvotes = [...new Set(this.allByNum[num].upvotes)];
          }
        }
      },
    },
  });
})();
