import { createApp } from 'vue';

import App from './App.vue';
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import router from './router';
import './style.css';

// Import specific icons you want to use
import { faBars, faHome, faFolderOpen, faPlay, faCircleUser, faScrewdriverWrench, faRightFromBracket, faUsers } from '@fortawesome/free-solid-svg-icons'

// Add icons to the library
library.add(faBars, faHome, faFolderOpen, faPlay, faCircleUser, faScrewdriverWrench, faRightFromBracket, faUsers);

createApp(App).use(router).component('FontAwesomeIcon', FontAwesomeIcon).mount('#app');
