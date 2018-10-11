const SimpleOauth2 = require('simple-oauth2');
const express = require('express');
const next = require('next');
const jwt = require('jsonwebtoken');
const port = parseInt(process.env.PORT, 10) || 4000;
const dev = process.env.NODE_ENV !== 'production';
const app = next({dev});
const handle = app.getRequestHandler();
const bodyParser = require('body-parser');
const request = require('request');
const grequest = require('graphql-request');
const cookieParser = require('cookie-parser');
const fileUpload = require('express-fileupload');
const sharp = require('sharp');
const acceptWebp = require('accept-webp');

app.prepare().then(() => {
  const server = express();
  const staticPath = __dirname + '/uploads';

  server.use(acceptWebp(staticPath, ['jpg', 'jpeg', 'png']));
  server.use(express.static(staticPath));

  server.use(bodyParser.json());
  server.use(cookieParser());
  server.use(fileUpload());
  server.use(
    bodyParser.urlencoded({
      extended: true,
    }),
  );

  checkToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
      next();
      return;
    }

    jwt.verify(token, process.env.JWT_SECRET, function(err, decoded) {
      if (err) {
        next();
        return;
      } else {
        req.userId = decoded.userId;
        req.token = token;
        next();
        return;
      }
    });
  };
  server.use(checkToken);

  server.post('/auth', async (req, res) => {
    const originalRes = res;
    if (req && req.body && req.body.ocode) {
      if (req.body.ocode.length < 30) {
        //github oauth
        const oauth2 = SimpleOauth2.create({
          client: {
            id: process.env.GITHUB_ID,
            secret: process.env.GITHUB_SECRET,
          },
          auth: {
            tokenHost: 'https://github.com',
            tokenPath: '/login/oauth/access_token',
            authorizePath: '/login/oauth/authorize',
          },
        });
        const options = {code: req.body.ocode};

        try {
          const result = await oauth2.authorizationCode.getToken(options);

          const otoken = oauth2.accessToken.create(result);
          const githubToken = result.access_token;
          var opts = {
            uri: 'https://api.github.com/user',
            gzip: true,
            headers: {
              Authorization: 'token ' + result.access_token,
              'User-Agent': 'patcito',
            },
          };
          request(opts, function(err, res, body) {
            // now body and res.body both will contain decoded content.
            //
            const bodyJson = JSON.parse(body);

            const checkUserRequestopts = {
              uri: 'http://localhost:8080/v1alpha1/graphql',
              json: true,
              query: `query User($githubId: String!){
  						User(where: {githubId: {_eq: $githubId}}) {
						  id
						  githubEmail
						  name
						  Companies {
							id
							name
							description
							url
							Industry
							yearFounded
						  }
						}
						}`,
              headers: {
                'X-Hasura-Access-Key': process.env.HASURA_SECRET,
              },
            };
            const checkUserRequestVars = {
              githubId: bodyJson.id + '',
            };
            const client = new grequest.GraphQLClient(
              checkUserRequestopts.uri,
              {
                headers: checkUserRequestopts.headers,
              },
            );
            client
              .request(checkUserRequestopts.query, checkUserRequestVars)
              .then(ugdata => {
                const currentUser = ugdata.User[0];
                if (currentUser && currentUser.id) {
                  currentUser.recruiter = true;
                  var token = jwt.sign(
                    {token: otoken, userId: currentUser.id},
                    process.env.JWT_SECRET,
                    {
                      expiresIn: '200 days', // expires in 24 hours
                    },
                  );
                  return originalRes.status(200).send({
                    auth: true,
                    token: token,
                    user: currentUser,
                  });
                }
                var uopts = {
                  uri: 'http://localhost:8080/v1alpha1/graphql',
                  json: true,
                  query: `mutation insert_User($name: String,
							$githubEmail: String!,
							$githubId: String,
							$githubAvatarUrl: String,
							  $githubUsername: String,
							 $githubAccessToken: String,
							 $githubBlogUrl: String,
							 $githubFollowers: Int )
							{insert_User(objects: {
							name: $name,
							githubEmail: $githubEmail,
							githubId: $githubId,
							githubAvatarUrl: $githubAvatarUrl,
							githubUsername:  $githubUsername,
							githubAccessToken: $githubAccessToken,
							githubBlogUrl: $githubBlogUrl,
							githubFollowers: $githubFollowers

											}){
										returning{
								  id
											  githubEmail
											  name

							}
									}}`,
                  headers: {
                    'X-Hasura-Access-Key': process.env.HASURA_SECRET,
                  },
                };
                const client = new grequest.GraphQLClient(uopts.uri, {
                  headers: uopts.headers,
                });
                bodyJson.id += '';
                const variables = {
                  name: bodyJson.name,
                  githubEmail: bodyJson.email,
                  githubId: bodyJson.id,
                  githubAvatarUrl: bodyJson.avatar_url,
                  githubUsername: bodyJson.login,
                  githubAccessToken: githubToken,
                  githubBlogUrl: bodyJson.blog,
                  githubFollowers: bodyJson.followers,
                };
                client.request(uopts.query, variables).then(gdata => {
                  var token = jwt.sign(
                    {token: otoken, userId: gdata.insert_User.returning.id},
                    process.env.JWT_SECRET,
                    {
                      expiresIn: 864000, // expires in 24 hours
                    },
                  );
                  return originalRes.status(200).send({
                    auth: true,
                    token: token,
                    user: gdata.insert_User.returning[0],
                  });
                });
              });
          });
        } catch (error) {
          console.error('Access Token Error', error.message);
          return res.status(500).json('Authentication failed');
        }
      } else if (req.body.ocode.length > 30) {
        console.log('linkedin');
        //github oauth
        const oauth2 = SimpleOauth2.create({
          client: {
            id: process.env.LINKEDIN_ID,
            secret: process.env.LINKEDIN_SECRET,
          },
          auth: {
            tokenHost: 'https://api.linkedin.com',
            tokenPath: '/oauth/v2/accessToken',
            authorizePath: '/oauth/v2/authorization',
          },
        });
        const options = {code: req.body.ocode};

        try {
          const opts = {
            uri:
              'https://www.linkedin.com/oauth/v2/accessToken?code=' +
              options.code +
              '&grant_type=authorization_code&redirect_uri=http://localhost:4000&client_id=' +
              process.env.LINKEDIN_ID +
              '&client_secret=' +
              process.env.LINKEDIN_SECRET,
            headers: {
              'Content-Type': 'x-www-form-urlencoded',
            },
          };
          request(opts, function(err, res, body) {
            const otoken = JSON.parse(body).access_token;
            const aopts = {
              uri:
                'https://api.linkedin.com/v1/people/~:(email-address,firstName,lastName,id,headline,siteStandardProfileRequest,industry,picture-url,formatted-name,positions)?format=json',
              headers: {
                Authorization: 'Bearer ' + otoken,
              },
            };
            request(aopts, function(err, res, body) {
              // now body and res.body both will contain decoded content.
              //
              const bodyJson = JSON.parse(body);

              const checkUserRequestopts = {
                uri: 'http://localhost:8080/v1alpha1/graphql',
                json: true,
                query: `query User($linkedinId: String!){
  						User(where: {linkedinId: {_eq: $linkedinId}}) {
						  id
						  linkedinEmail
						  name
						  Companies {
							id
							name
							description
							url
							Industry
							yearFounded
						  }	}
						}`,
                headers: {
                  'X-Hasura-Access-Key': process.env.HASURA_SECRET,
                },
              };
              const checkUserRequestVars = {
                linkedinId: bodyJson.id,
              };
              const client = new grequest.GraphQLClient(
                checkUserRequestopts.uri,
                {
                  headers: checkUserRequestopts.headers,
                },
              );
              client
                .request(checkUserRequestopts.query, checkUserRequestVars)
                .then(ugdata => {
                  const currentUser = ugdata.User[0];
                  if (currentUser && currentUser.id) {
                    const token = jwt.sign(
                      {token: otoken, userId: currentUser.id},
                      process.env.JWT_SECRET,
                      {
                        expiresIn: 86400, // expires in 24 hours
                      },
                    );
                    currentUser.recruiter = true;
                    return originalRes.status(200).send({
                      auth: true,
                      token: token,
                      user: currentUser,
                    });
                  }
                  const uopts = {
                    uri: 'http://localhost:8080/v1alpha1/graphql',
                    json: true,
                    query: `mutation insert_User($name: String,
					$linkedinEmail: String!,
					$linkedinId: String,
					$linkedinAvatarUrl: String,
					 $linkedinAccessToken: String,
					$firstName: String,
					$lastName: String,
					$headlineLinkedin: String,
					$industryLinkedin: String,
					$companyLinkedin: String,
					$linkedinUrl: String,
					  )
					{insert_User(objects: {
					name: $name,
					linkedinEmail: $linkedinEmail,
					linkedinId: $linkedinId,
					linkedinAvatarUrl: $linkedinAvatarUrl,
					linkedinAccessToken: $linkedinAccessToken,
					firstName: $firstName,
					lastName: $lastName,
					headlineLinkedin: $headlineLinkedin,
					industryLinkedin: $industryLinkedin,
					companyLinkedin: $companyLinkedin,
					linkedinUrl: $linkedinUrl,
					}){
					returning{
						  id
						  linkedinEmail
						  name
					}
					}}`,
                    headers: {
                      'X-Hasura-Access-Key': process.env.HASURA_SECRET,
                    },
                  };
                  const variables = {
                    name: bodyJson.formattedName,
                    linkedinEmail: bodyJson.emailAddress,
                    linkedinId: bodyJson.id,
                    linkedinAvatarUrl: bodyJson.pictureUrl,
                    linkedinAccessToken: otoken,
                    firstName: bodyJson.firstName,
                    lastName: bodyJson.lastName,
                    headlineLinkedin: bodyJson.headline,
                    industryLinkedin: bodyJson.industry,
                    companyLinkedin: bodyJson.positions.values[0].company.name,
                    linkedinUrl: bodyJson.siteStandardProfileRequest.url,
                  };
                  client.request(uopts.query, variables).then(gdata => {
                    const currentUser = gdata.insert_User.returning[0];
                    currentUser.recruiter = true;
                    const token = jwt.sign(
                      {token: otoken, userId: currentUser.id},
                      process.env.JWT_SECRET,
                      {
                        expiresIn: 86400, // expires in 24 hours
                      },
                    );

                    return originalRes.status(200).send({
                      auth: true,
                      token: token,
                      user: currentUser,
                    });
                  });
                });
            });
            //    return originalRes.status(500).json(body);
          });
        } catch (error) {
          console.error('Access Token Error Linkedin', error.message);
          return res.status(500).json('Authentication failed');
        }
      }
    } else {
      res.json({});
    }
  });
  server.get('/checksession', (req, res) => {
    var token = req.headers['x-access-token'];
    if (!token)
      return res.status(401).send({auth: false, message: 'No token provided.'});
    jwt.verify(token, process.env.JWT_SECRET, function(err, decoded) {
      if (err) {
        return res.status(500).send({
          auth: false,
          message: 'Failed to authenticate token.',
          err: err,
          token: token,
          s: process.env.JWT_SECRET,
        });
      } else {
        return res.status(200).json('ok');
      }
    });
  });

  server.get('/api', (req, res) => {
    var token = req.headers['x-access-token'];
    if (!token) {
      const x = {
        'X-Hasura-Role': 'anon',
      };
      console.log(req.headers, 'ok', x);
      return res.status(200).json(x);
    }

    jwt.verify(token, process.env.JWT_SECRET, function(err, decoded) {
      if (err) {
        const x = {
          'X-Hasura-Role': 'anon',
        };
        return res.status(200).send(x);
      } else {
        console.log('decode token', decoded);
        const x = {
          'X-Hasura-User-Id': decoded.userId + '',
          'X-Hasura-Role': decoded.userId ? 'user' : 'anon',
          'X-Hasura-Access-Key': process.env.JWT_SECRET,
          'X-Hasura-Custom': 'custom value',
        };
        console.log(req.headers, 'ok', x);
        return res.status(200).json(x);
      }
    });
  });

  server.get('/jobs/update/:id', (req, res) => {
    return app.render(req, res, '/newjob', {id: req.params.id});
  });

  server.get('/jobs/companies/:companyId', (req, res) => {
    return app.render(req, res, '/', {companyId: req.params.companyId});
  });

  server.get('/companies', (req, res) => {
    return app.render(req, res, '/', {companies: true});
  });

  server.get('/me/companies', (req, res) => {
    return app.render(req, res, '/', {companies: true, me: true});
  });

  server.get('/companies/:companyId', (req, res) => {
    return app.render(req, res, '/showcompany', {
      companyId: req.params.companyId,
      action: 'showCompany',
    });
  });

  server.get('/companies/:companyId/edit', (req, res) => {
    return app.render(req, res, '/editcompany', {
      companyId: req.params.companyId,
      action: 'editCompany',
    });
  });

  server.post('/upload', function(req, res) {
    if (!req.files) return res.status(400).json('No files were uploaded.');
    let sampleFile = req.files.file;
    sharp(sampleFile.data).toFile(
      'uploads/' + req.get('companyId') + '-' + req.userId + '-logo.webp',
      (err, info) => {
        if (err) {
          res.status(500).json(err);
        }
        sharp(sampleFile.data).toFile(
          'uploads/' + req.get('companyId') + '-' + req.userId + '-logo.png',
          (err, info) => {
            if (err) {
              res.status(500).json(err);
            }
            console.log(err, info);
            res.status(200).json('ok');
          },
        );
      },
    );
  });

  server.post('/uploadEmployee1Avatar', function(req, res) {
    if (!req.files) return res.status(400).json('No files were uploaded.');
    let sampleFile = req.files.file;
    sharp(sampleFile.data).toFile(
      'uploads/' +
        req.get('companyId') +
        '-' +
        req.userId +
        '-employee1avatar.webp',
      (err, info) => {
        if (err) {
          res.status(500).json(err);
        }
        sharp(sampleFile.data).toFile(
          'uploads/' +
            req.get('companyId') +
            '-' +
            req.userId +
            '-employee1avatar.png',
          (err, info) => {
            if (err) {
              res.status(500).json(err);
            }
            console.log(err, info);
            res.status(200).json('ok');
          },
        );
      },
    );
  });

  server.post('/uploadEmployee2Avatar', function(req, res) {
    if (!req.files) return res.status(400).json('No files were uploaded.');
    let sampleFile = req.files.file;
    sharp(sampleFile.data).toFile(
      'uploads/' +
        req.get('companyId') +
        '-' +
        req.userId +
        '-employee2avatar.webp',
      (err, info) => {
        if (err) {
          res.status(500).json(err);
        }
        sharp(sampleFile.data).toFile(
          'uploads/' +
            req.get('companyId') +
            '-' +
            req.userId +
            '-employee2avatar.png',
          (err, info) => {
            if (err) {
              res.status(500).json(err);
            }
            console.log(err, info);
            res.status(200).json('ok');
          },
        );
      },
    );
  });

  server.post('/uploadMedia1Image', function(req, res) {
    if (!req.files) return res.status(400).json('No files were uploaded.');
    let sampleFile = req.files.file;
    sharp(sampleFile.data).toFile(
      'uploads/' + req.get('companyId') + '-' + req.userId + '-1media.webp',
      (err, info) => {
        if (err) {
          res.status(500).json(err);
        }
        sharp(sampleFile.data).toFile(
          'uploads/' + req.get('companyId') + '-' + req.userId + '-1media.png',
          (err, info) => {
            if (err) {
              res.status(500).json(err);
            }
            console.log(err, info);
            res.status(200).json('ok');
          },
        );
      },
    );
  });

  server.post('/uploadMedia2Image', function(req, res) {
    if (!req.files) return res.status(400).json('No files were uploaded.');
    let sampleFile = req.files.file;
    sharp(sampleFile.data).toFile(
      'uploads/' + req.get('companyId') + '-' + req.userId + '-2media.webp',
      (err, info) => {
        if (err) {
          res.status(500).json(err);
        }
        sharp(sampleFile.data).toFile(
          'uploads/' + req.get('companyId') + '-' + req.userId + '-2media.png',
          (err, info) => {
            if (err) {
              res.status(500).json(err);
            }
            console.log(err, info);
            res.status(200).json('ok');
          },
        );
      },
    );
  });

  server.post('/uploadMedia3Image', function(req, res) {
    if (!req.files) return res.status(400).json('No files were uploaded.');
    let sampleFile = req.files.file;
    sharp(sampleFile.data).toFile(
      'uploads/' + req.get('companyId') + '-' + req.userId + '-3media.webp',
      (err, info) => {
        if (err) {
          res.status(500).json(err);
        }
        sharp(sampleFile.data).toFile(
          'uploads/' + req.get('companyId') + '-' + req.userId + '-3media.png',
          (err, info) => {
            if (err) {
              res.status(500).json(err);
            }
            console.log(err, info);
            res.status(200).json('ok');
          },
        );
      },
    );
  });

  server.get('/*logo.png', (req, res) => {
    res.sendFile(staticPath + '/defaultlogo.png');
  });

  server.get('/*avatar.png', (req, res) => {
    res.sendFile(staticPath + '/defaultavatar.png');
  });

  server.get('/*media.png', (req, res) => {
    res.sendFile(staticPath + '/defaultmedia.png');
  });

  server.get('*', (req, res) => {
    return handle(req, res);
  });

  server.listen(port, err => {
    if (err) throw err;
    console.log(`> Ready on http://localhost:${port}`);
  });
});