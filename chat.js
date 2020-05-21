import DOMPurify from './lib/purify.min.js';
import marked from './lib/marked.min.js';
import Vue from './lib/vue.min.js';
import io from './lib/socket.io.js';
import * as timeago from './lib/timeago.min.js';
import feathers from './lib/feathers.js';

const topic = document.querySelector('#topic');
const info = document.querySelector('#info');

topic.addEventListener('click', () => {
  if (info.style.display === 'none') {
    info.style.display = ''
  } else {
    info.style.display = 'none'
  }
});

(async () => {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {    
    if (node.hasAttribute('src')) {
      node.setAttribute('src', `https://external-content.duckduckgo.com/iu/?u=${node.getAttribute('src')}`);
    }
  });

  const API_URL = `http://localhost:2020`;

  function sanitize(message) {
    message.sanitized = DOMPurify
      .sanitize(marked(message.content), {
        FORBID_ATTR: [
          'style',
          'onerror',
          'onload',
        ],
        FORBID_TAGS: [
          'table',
          'script',
          'audio',
          'video',
          'style',
          'iframe',
          'textarea',
          'frame',
          'frameset'
        ],
      });
  }

  function setTimesent(message) {
    message.timesent = timeago.format(message.created_at);
  }

  function processMessage(message) {
    setTimesent(message);
    sanitize(message);
    message.showSource = false;
    message.isPotentiallyNaughty = message.message.match(/<|>/i);
  }

  const client = feathers();
  client.configure(feathers.socketio(io(API_URL)));
  const voxPopuliService = client.service('vox/populi');
  new Vue({
    el: '#messages',
    data: {
      showInfo: true,
      isAdmin: localStorage.token,
      selectedTab: 'questions',
      all: {
        questions: [],
        submissions: [],
        ideas: [],
      },
      authors: {},
    },
    async created() {
      document.querySelector('.chat').style.display = '';
      this.loadMessages();
    },
    computed: {
      allByNum() {
        const byNum = {};
        this.all.questions.forEach((item) => byNum[item.num] = item);
        this.all.submissions.forEach((item) => byNum[item.num] = item);
        this.all.ideas.forEach((item) => byNum[item.num] = item);
        return byNum;
      },
      sortedItems() {
        let items = [];
        if (this.selectedTab === 'questions') {
          items = this.all.questions;
        } else if (this.selectedTab === 'ideas') {
          items = this.all.ideas;
        } else if (this.selectedTab === 'submissions') {
          items = this.all.submissions;
        }

        const sorted = items.sort((a, b) => {
          if (a.subscriber && !b.subscriber) return -1;
          if (!a.subscriber && b.subscriber) return 1;
          const diff = b.upvotes.length - a.upvotes.length;
          if (diff !== 0) return diff;
          return new Date(a.created_at) - new Date(b.created_at);
        });
        return sorted;
      }
    },
    methods: {
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
          if (!num && !this.allByNum[num]) return;
          if (command === '!comment') {
            const index = this.allByNum[num].comments.findIndex((item) => item.id === message.id);
            if (index !== -1) {
              this.allByNum[num].comments.splice(index, 1);
            }
          }
        }
      },
      async archive(message) {
        await voxPopuliService.remove(message._id, {
          query: {
            key: localStorage.token,
          }
        });
      },
      async loadMessages() {
        const all = await voxPopuliService.find();
        voxPopuliService.on('created', (message) => {
          this.addLatestMessage(message);
        });
        voxPopuliService.on('removed', (message) => {
          this.onRemoved(message);
        })
        const processMessages = message => {
          processMessage(message);
          message.upvotes = [...new Set(message.upvotes)];
          message.comments.forEach(processMessage);
        };
        all.questions.forEach(processMessages);
        all.ideas.forEach(processMessages);
        all.submissions.forEach(processMessages);
        this.all = all;
        setInterval(() => {
          const setTimeSents = message => {
            setTimesent(message);
            message.comments.forEach(setTimesent);
          };
          all.questions.forEach(setTimeSents);
          all.ideas.forEach(setTimeSents);
          all.submissions.forEach(setTimeSents);
        }, 2000);
      },
      addLatestMessage(message) {
        const args = message.message.split(' ');
        const command = args.shift();
        if (command.match(/^!(ask|idea|submit)/)) {
          if (!message.num) return;
          const value = args.join(' ');
          message.content = value;
          message.comments = [];
          message.upvotes = [];
          message.upvote_count = 0;
          if (command === '!ask') {
            this.all.questions.push(message);
          } else if (command === '!idea') {
            this.all.ideas.push(message);
          } else if (command === '!submit') {
            this.all.submissions.push(message);
          }
          processMessage(message);
        } else if (command.match(/^!(comment|upvote)/)) {
          const num = (args.shift() || '').replace('#', '');
          if (!num && !isNaN(num) && !this.allByNum[num]) return;
          if (command === '!comment') {
            message.content = args.join(' ');
            processMessage(message);
            this.allByNum[num].comments.push(message);
          } else if (command === '!upvote') {
            this.allByNum[num].upvotes.push(message.display_name);
            this.allByNum[num].upvotes = [...new Set(this.allByNum[num].upvotes)];
          }
        }
      },
    }
  });
})();
