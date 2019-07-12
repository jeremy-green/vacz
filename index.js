const Reattempt = require('reattempt').default;
const nodeMachineId = require('node-machine-id');
const sucks = require('sucks');
const EcoVacsAPI = sucks.EcoVacsAPI;
const VacBot = sucks.VacBot;
const backoff = require('backoff');

/*
"US": {
  "name": "United States",
  "continent": "NA"
},
*/
const device_id = EcoVacsAPI.md5(nodeMachineId.machineIdSync());
const api = new EcoVacsAPI(device_id, 'US', 'NA');

const { VACZ_EMAIL: email, VACZ_PASS: pass, VACZ_NICK: nickname } = process.env;

const accountId = email;
const passwordHash = EcoVacsAPI.md5(pass);

const times = 10;
const delay = 1000;

const exponentialBackoff = backoff.exponential({ initialDelay: delay });
exponentialBackoff.failAfter(times);

(async () => {
  try {
    await Reattempt.run(
      { times, delay },
      async () =>
        await api.connect(
          accountId,
          passwordHash,
        ),
    );

    const devices = await api.devices();

    console.log('devices', devices);

    const [vacuum] = devices.filter(({ nick }) => nick === nickname);
    const vacbot = new VacBot(
      api.uid,
      EcoVacsAPI.REALM,
      api.resource,
      api.user_access_token,
      vacuum,
      'NA',
    );

    const handleError = e => {
      console.log('handleError', e);

      const { errno } = e;
      if (errno === '109') {
        vacbot.removeListener('error', handleError);
        handleVac(vacbot);
      }
    };

    vacbot.on('error', handleError);

    vacbot.on('ready', e => {
      console.log('ready', e);
    });

    vacbot.on('CleanReport', e => console.log(e));

    // vacbot.on('stanza', e => {
    //   console.log('stanza', JSON.stringify(e, null, 4));
    // });

    // vacbot.on('BatteryInfo', battery => {
    //   console.log('Battery level: %d%', Math.round(battery * 100));
    // });

    vacbot.connect_and_wait_until_ready();
  } catch (e) {
    console.log(e);
    process.exit();
  }
})();

async function handleVac(vacbot) {
  console.log('handleVac');

  try {
    await Reattempt.run({ times }, () => {
      console.log('Reattempt...');

      return new Promise((resolve, reject) => {
        vacbot.once('ChargeState', e => {
          console.log('ChargeState', e);

          exponentialBackoff.reset();
          resolve(e);
        });

        const handleError = e => {
          console.log('reattempt:error', e);

          const { errno } = e;
          if (errno === '109') {
            vacbot.removeListener('error', handleError);
            reject(e);
          }
        };

        vacbot.on('error', handleError);
        setTimeout(() => {
          vacbot.run('clean');
        }, 2000);
      });
    });
  } catch (e) {
    console.log('exponentialBackoff:error', e);

    exponentialBackoff.on('ready', () => {
      console.log('exponentialBackoff:ready');

      handleVac(vacbot);
      // exponentialBackoff.backoff();
    });

    exponentialBackoff.on('fail', () => {
      console.log('exponentialBackoff:fail');
    });

    exponentialBackoff.on('backoff', () => {
      console.log('exponentialBackoff:backoff');
    });

    exponentialBackoff.backoff();
  }
}
