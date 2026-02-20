module.exports = {
  onPreBuild: ({ utils }) => {
    console.log('Preparing Next.js build for Netlify deployment...');
  },
  onBuild: ({ utils }) => {
    console.log('Next.js build completed, preparing for Netlify functions...');
  },
  onPostBuild: ({ utils }) => {
    console.log('Next.js build post-processing for Netlify completed');
  }
};
