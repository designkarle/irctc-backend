import Input from '../ui/Input';
import Select from '../ui/Select';
import { formatSeatType } from '../../utils/format';

const GENDER_OPTIONS = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
];

export default function PassengerForm({ index, seat, register, errors }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <p className="text-sm font-semibold text-primary-900 mb-3">
        Passenger {index + 1} — Seat #{seat.seatNumber} ({formatSeatType(seat.seatType)})
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input
          label="Full Name"
          placeholder="Enter name"
          {...register(`passengers.${index}.name`, { required: 'Name is required' })}
          error={errors?.passengers?.[index]?.name?.message}
        />
        <Input
          label="Age"
          type="number"
          placeholder="Age"
          {...register(`passengers.${index}.age`, {
            required: 'Age is required',
            min: { value: 1, message: 'Min 1' },
            max: { value: 120, message: 'Max 120' },
            valueAsNumber: true,
          })}
          error={errors?.passengers?.[index]?.age?.message}
        />
        <Select
          label="Gender"
          placeholder="Select"
          options={GENDER_OPTIONS}
          {...register(`passengers.${index}.gender`, { required: 'Gender is required' })}
          error={errors?.passengers?.[index]?.gender?.message}
        />
      </div>
    </div>
  );
}
