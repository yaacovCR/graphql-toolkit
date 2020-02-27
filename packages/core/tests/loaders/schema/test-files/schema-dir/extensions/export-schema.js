const { makeExecutableSchema } = require('graphql-tools-fork');
const { doc } = require('./type-defs');

const schema = makeExecutableSchema({
  typeDefs: [doc],
});

exports.schema = schema;