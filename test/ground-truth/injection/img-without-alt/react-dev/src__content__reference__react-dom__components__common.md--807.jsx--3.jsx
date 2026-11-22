export default function Avatar({ user }) {
  return (
    <img
      src={user.imageUrl}
     
      className="avatar"
      style={{
        width: user.imageSize,
        height: user.imageSize
      }}
    />
  );
}
